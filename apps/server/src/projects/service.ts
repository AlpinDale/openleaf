import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  detectRootDocPath,
  type ProjectDetails,
  type ProjectSummary,
  validateEntryName,
  YDOC_TEXTS,
} from '@openleaf/shared'
import { desc, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import type { AppContext } from '../context.js'
import {
  entries,
  projectMembers,
  projects,
  projectYdocs,
  users,
} from '../db/schema.js'
import { badRequest, conflict, notFound, tooLarge } from '../errors.js'
import { assertProjectStateWithinLimit } from '../realtime/admission.js'
import { deleteBlobsIfUnreferenced, releaseBlob } from '../tree/blobs.js'
import { projectLock } from '../tree/locks.js'
import { deletionOrder, loadEntries } from '../tree/model.js'
import { assertMaterializablePath } from '../tree/paths.js'
import type { IncomingContent } from '../tree/service.js'
import { projectSnapshotLocked } from '../tree/snapshot.js'
import type { ProjectRow } from '../types.js'

export type NewProjectFile = { path: string; content: IncomingContent }

const deletions = new WeakMap<AppContext, Map<string, Promise<void>>>()

export function assertProjectNotDeleting(ctx: AppContext, projectId: string) {
  if (deletions.get(ctx)?.has(projectId))
    throw conflict('Project is being deleted')
}

function templatesDir(): string {
  const candidates = [
    path.join(import.meta.dirname, 'templates'),
    path.resolve(import.meta.dirname, '../../src/projects/templates'),
  ]
  const found = candidates.find(dir => fs.existsSync(dir))
  if (!found) throw new Error('Project templates not found')
  return found
}

const LATEX_SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\^{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\~{}',
}

export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#^_%~]/g, ch => LATEX_SPECIALS[ch])
}

export function templateFiles(
  template: 'blank' | 'example',
  vars: { title: string; author: string }
): NewProjectFile[] {
  const dir = path.join(templatesDir(), template)
  const files: NewProjectFile[] = []
  for (const name of fs.readdirSync(dir).sort()) {
    const text = fs
      .readFileSync(path.join(dir, name), 'utf8')
      .replaceAll('{{TITLE}}', escapeLatex(vars.title))
      .replaceAll('{{AUTHOR}}', escapeLatex(vars.author))
    files.push({ path: name, content: { kind: 'doc', text } })
  }
  return files
}

/**
 * Inserts a project with its owner, root folder, entries, and initial Y state.
 * Folders are created from file paths; `emptyFolders` adds folders with no files.
 */
export async function createProjectFromFiles(
  ctx: AppContext,
  input: {
    ownerId: string
    name: string
    files: NewProjectFile[]
    emptyFolders?: string[]
    rootDocPath?: string | null
    mainBibPath?: string | null
    compiler?: string
    image?: string
    spellLanguage?: string
    source: 'create' | 'import' | 'copy'
    message?: string
  }
): Promise<string> {
  try {
    const filePaths = new Set<string>()
    let docBytes = 0
    for (const file of input.files) {
      if (file.path.split('/').some(segment => validateEntryName(segment)))
        throw badRequest('Invalid project file path')
      assertMaterializablePath(ctx.config.dataDir, file.path)
      if (filePaths.has(file.path))
        throw badRequest('Duplicate project file path')
      filePaths.add(file.path)
      if (file.content.kind === 'doc') {
        docBytes += Buffer.byteLength(file.content.text)
        if (docBytes > ctx.config.maxProjectStateBytes)
          throw tooLarge('Initial documents exceed project state limit')
      }
    }
    const assertNoFileParent = (path: string, includeLeaf: boolean) => {
      for (
        let slash = includeLeaf ? path.length : path.lastIndexOf('/');
        slash > 0;
        slash = path.lastIndexOf('/', slash - 1)
      )
        if (filePaths.has(path.slice(0, slash)))
          throw badRequest('A project path cannot be both a file and a folder')
    }
    for (const file of input.files) assertNoFileParent(file.path, false)
    for (const folder of input.emptyFolders ?? []) {
      if (folder.split('/').some(segment => validateEntryName(segment)))
        throw badRequest('Invalid project folder path')
      assertMaterializablePath(ctx.config.dataDir, folder)
      assertNoFileParent(folder, true)
    }
    const now = Date.now()
    const projectId = crypto.randomUUID()
    const rootId = crypto.randomUUID()
    const ydoc = new Y.Doc()
    const texts = ydoc.getMap<Y.Text>(YDOC_TEXTS)
    const folderIds = new Map<string, string>([['', rootId]])
    const rows: (typeof entries.$inferInsert)[] = [
      {
        id: rootId,
        projectId,
        parentId: null,
        kind: 'folder',
        name: '',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const ensureFolder = (dirPath: string): string => {
      const existing = folderIds.get(dirPath)
      if (existing) return existing
      let parentId: string = rootId
      let currentPath = ''
      for (const name of dirPath.split('/')) {
        currentPath = currentPath ? `${currentPath}/${name}` : name
        const folderId = folderIds.get(currentPath)
        if (folderId) {
          parentId = folderId
          continue
        }
        const id = crypto.randomUUID()
        rows.push({
          id,
          projectId,
          parentId,
          kind: 'folder',
          name,
          createdAt: now,
          updatedAt: now,
        })
        folderIds.set(currentPath, id)
        parentId = id
      }
      return parentId
    }
    for (const dir of input.emptyFolders ?? []) ensureFolder(dir)
    const docIdsByPath = new Map<string, string>()
    for (const file of input.files) {
      const slash = file.path.lastIndexOf('/')
      const parentId = ensureFolder(
        slash === -1 ? '' : file.path.slice(0, slash)
      )
      const id = crypto.randomUUID()
      const name = file.path.slice(slash + 1)
      if (file.content.kind === 'doc') {
        texts.set(id, new Y.Text(file.content.text))
        docIdsByPath.set(file.path, id)
        rows.push({
          id,
          projectId,
          parentId,
          kind: 'doc',
          name,
          size: Buffer.byteLength(file.content.text),
          createdAt: now,
          updatedAt: now,
        })
      } else {
        rows.push({
          id,
          projectId,
          parentId,
          kind: 'file',
          name,
          blobHash: file.content.blob.hash,
          gitOid: file.content.blob.gitOid,
          size: file.content.blob.size,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
    let rootDocPath = input.rootDocPath
    if (rootDocPath === undefined) {
      rootDocPath = detectRootDocPath([...docIdsByPath.keys()], p => {
        const id = docIdsByPath.get(p)
        return id ? (texts.get(id)?.toString() ?? null) : null
      })
    }
    const rootDocId = rootDocPath?.toLowerCase().endsWith('.tex')
      ? (docIdsByPath.get(rootDocPath) ?? null)
      : null
    const mainBibDocId = input.mainBibPath?.toLowerCase().endsWith('.bib')
      ? (docIdsByPath.get(input.mainBibPath) ?? null)
      : null
    let state: Buffer
    try {
      const encoded = assertProjectStateWithinLimit(
        ydoc,
        ctx.config.maxProjectStateBytes
      )
      state = Buffer.from(
        encoded.buffer,
        encoded.byteOffset,
        encoded.byteLength
      )
    } finally {
      ydoc.destroy()
    }
    try {
      await ctx.history.lock(projectId).runExclusive(() =>
        projectLock(projectId).runExclusive(async () => {
          ctx.db.transaction(tx => {
            tx.insert(projects)
              .values({
                id: projectId,
                name: input.name,
                ownerId: input.ownerId,
                rootDocId,
                mainBibDocId,
                compiler: input.compiler ?? 'pdflatex',
                image: input.image ?? ctx.config.texliveImages[0],
                spellLanguage: input.spellLanguage ?? 'en_US',
                createdAt: now,
                updatedAt: now,
              })
              .run()
            tx.insert(projectMembers)
              .values({
                projectId,
                userId: input.ownerId,
                role: 'owner',
                createdAt: now,
              })
              .run()
            for (const row of rows) tx.insert(entries).values(row).run()
            tx.insert(projectYdocs)
              .values({ projectId, state, updatedAt: now })
              .run()
          })
          await ctx.history.commitLocked(
            projectId,
            {
              source: input.source,
              authors: [input.ownerId],
              message: input.message,
            },
            null,
            await projectSnapshotLocked(ctx, projectId)
          )
        })
      )
    } catch (err) {
      await deleteProject(ctx, projectId)
      throw err
    }
    return projectId
  } finally {
    for (const file of input.files) {
      if (file.content.kind === 'file')
        await releaseBlob(ctx.db, ctx.config.dataDir, file.content.blob)
    }
  }
}

export function listProjects(
  ctx: AppContext,
  userId: string
): ProjectSummary[] {
  return ctx.db
    .select({
      id: projects.id,
      name: projects.name,
      role: projectMembers.role,
      updatedAt: projects.updatedAt,
      lastOpenedAt: projects.lastOpenedAt,
      archivedAt: projects.archivedAt,
      trashedAt: projects.trashedAt,
      ownerName: users.name,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.id, projects.ownerId))
    .where(eq(projectMembers.userId, userId))
    .orderBy(desc(projects.updatedAt))
    .all()
}

export function projectDetails(
  ctx: AppContext,
  project: ProjectRow,
  role: ProjectDetails['role']
): ProjectDetails {
  const members = ctx.db
    .select({ id: users.id, name: users.name, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, project.id))
    .all()
  return {
    id: project.id,
    name: project.name,
    ownerId: project.ownerId,
    rootDocId: project.rootDocId,
    compiler: project.compiler as ProjectDetails['compiler'],
    image: project.image,
    spellLanguage: project.spellLanguage,
    mainBibDocId: project.mainBibDocId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
    archivedAt: project.archivedAt,
    trashedAt: project.trashedAt,
    role,
    images: [...ctx.config.texliveImages],
    gitUrl: `${ctx.config.publicUrl}/git/${project.id}`,
    limits: { maxUploadBytes: ctx.config.maxUploadBytes },
    members,
  }
}

export async function copyProject(
  ctx: AppContext,
  source: ProjectRow,
  ownerId: string,
  name: string
): Promise<string> {
  return projectLock(source.id).runExclusive(async () => {
    const current = ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, source.id))
      .get()
    if (!current) throw notFound('Source project not found')
    source = current
    const snapshot = await projectSnapshotLocked(ctx, source.id)
    const files: NewProjectFile[] = []
    const emptyFolders: string[] = []
    let rootDocPath: string | null = null
    let mainBibPath: string | null = null
    for (const entry of snapshot.entries) {
      if (entry.kind === 'folder') emptyFolders.push(entry.path)
      else if (entry.kind === 'doc') {
        files.push({
          path: entry.path,
          content: { kind: 'doc', text: entry.text },
        })
        if (entry.id === source.rootDocId) rootDocPath = entry.path
        if (entry.id === source.mainBibDocId) mainBibPath = entry.path
      } else {
        files.push({
          path: entry.path,
          content: {
            kind: 'file',
            blob: { hash: entry.hash, size: entry.size, gitOid: entry.gitOid },
          },
        })
      }
    }
    return createProjectFromFiles(ctx, {
      ownerId,
      name,
      files,
      emptyFolders,
      rootDocPath,
      mainBibPath,
      compiler: source.compiler,
      image: source.image,
      spellLanguage: source.spellLanguage,
      source: 'copy',
      message: `Copy of ${source.name}`,
    })
  })
}

export function deleteProject(
  ctx: AppContext,
  projectId: string
): Promise<void> {
  let pending = deletions.get(ctx)
  if (!pending) {
    pending = new Map()
    deletions.set(ctx, pending)
  }
  const jobs = pending
  const current = jobs.get(projectId)
  if (current) return current
  const deletion = deleteProjectInternal(ctx, projectId).finally(() =>
    jobs.delete(projectId)
  )
  jobs.set(projectId, deletion)
  return deletion
}

async function deleteProjectInternal(ctx: AppContext, projectId: string) {
  // Jobs may need the tree lock to finish, so drain them before taking locks.
  await Promise.all([
    ctx.compile.closeProject(projectId),
    ctx.exports.closeProject(projectId),
  ])
  await ctx.history.lock(projectId).runExclusive(async () => {
    await ctx.history.drainGarbageCollectors(projectId)
    await projectLock(projectId).runExclusive(async () => {
      const state = ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()
      if (!state) return
      let hashes: (string | null)[] = []
      let pendingMarker: Promise<void> | undefined
      await ctx.realtime.evict(projectId, () => {
        const rows = loadEntries(ctx.db, projectId)
        hashes = rows.flatMap(row => (row.blobHash ? [row.blobHash] : []))
        const deleting = deletionOrder(rows)
        ctx.db.transaction(tx => {
          for (const id of deleting)
            tx.delete(entries).where(eq(entries.id, id)).run()
          tx.delete(projects).where(eq(projects.id, projectId)).run()
        })
        pendingMarker = ctx.history.forget(projectId)
      })
      await pendingMarker
      const { dataDir } = ctx.config
      for (const dir of [
        path.join(dataDir, 'compiles'),
        path.join(dataDir, 'builds'),
      ]) {
        const names = await fsp.readdir(dir).catch(() => [] as string[])
        for (const name of names) {
          if (name.startsWith(`${projectId}-`)) {
            await fsp.rm(path.join(dir, name), { recursive: true, force: true })
          }
        }
      }
      await fsp.rm(ctx.history.gitdir(projectId), {
        recursive: true,
        force: true,
      })
      await deleteBlobsIfUnreferenced(ctx.db, dataDir, hashes)
    })
  })
}
