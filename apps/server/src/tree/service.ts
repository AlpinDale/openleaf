import { Readable } from 'node:stream'
import {
  classifyContent,
  isEditableFilename,
  MAX_EDITABLE_FILE_BYTES,
  type TreeEntry,
  validateEntryName,
  YDOC_CHANGES,
  YDOC_COMMENTS,
  YDOC_TEXTS,
} from '@openleaf/shared'
import { and, eq, inArray } from 'drizzle-orm'
import * as Y from 'yjs'
import type { AppContext } from '../context.js'
import {
  commentThreads,
  entries,
  projects,
  projectYdocs,
} from '../db/schema.js'
import { badRequest, conflict, notFound } from '../errors.js'
import { assertProjectStateWithinLimit } from '../realtime/admission.js'
import {
  type BlobInfo,
  deleteBlobsIfUnreferenced,
  putBlob,
  releaseBlob,
} from './blobs.js'
import { projectLock } from './locks.js'
import {
  buildPaths,
  deletionOrder,
  type EntryRow,
  loadEntries,
  subtreeIds,
  toTreeEntry,
} from './model.js'
import { assertMaterializablePath } from './paths.js'
import { projectYState } from './projected-state.js'

export type MutationOptions = {
  /** Emit `ctx.realtime.events 'changed'` (marks history dirty). Default true. */
  emitChanged?: boolean
}

/** File content arriving from an upload, URL, zip, or history restore. */
export type IncomingContent =
  | { kind: 'doc'; text: string }
  | { kind: 'file'; blob: BlobInfo }

const textDecoder = new TextDecoder('utf-8', { ignoreBOM: true })

/** Classifies bytes and stores binaries in the blob store. */
export async function contentFromBytes(
  ctx: AppContext,
  name: string,
  bytes: Uint8Array
): Promise<IncomingContent> {
  if (classifyContent(name, bytes) === 'doc') {
    return { kind: 'doc', text: textDecoder.decode(bytes) }
  }
  return { kind: 'file', blob: await putBlob(ctx.config.dataDir, bytes) }
}

/**
 * Reads a stream: editable names up to the doc size limit are buffered and
 * classified; everything else streams straight into the blob store.
 */
export async function contentFromStream(
  ctx: AppContext,
  name: string,
  stream: AsyncIterable<Buffer> & NodeJS.ReadableStream
): Promise<IncomingContent> {
  if (!isEditableFilename(name)) {
    return { kind: 'file', blob: await putBlob(ctx.config.dataDir, stream) }
  }
  const iterator = stream[Symbol.asyncIterator]()
  const chunks: Buffer[] = []
  let size = 0
  while (size <= MAX_EDITABLE_FILE_BYTES) {
    const next = await iterator.next()
    if (next.done) return contentFromBytes(ctx, name, Buffer.concat(chunks))
    chunks.push(next.value)
    size += next.value.byteLength
  }
  const rest = Readable.from(
    (async function* () {
      try {
        yield* chunks
        for (
          let next = await iterator.next();
          !next.done;
          next = await iterator.next()
        ) {
          yield next.value
        }
      } finally {
        await iterator.return?.()
      }
    })()
  )
  return { kind: 'file', blob: await putBlob(ctx.config.dataDir, rest) }
}

export function listTree(ctx: AppContext, projectId: string) {
  const rows = loadEntries(ctx.db, projectId)
  const root = rows.find(r => r.parentId === null)
  if (!root) throw notFound('Project not found')
  return {
    rootFolderId: root.id,
    entries: rows.filter(r => r.parentId !== null).map(toTreeEntry),
  }
}

function touchProject(ctx: AppContext, projectId: string) {
  ctx.db
    .update(projects)
    .set({ updatedAt: Date.now() })
    .where(eq(projects.id, projectId))
    .run()
}

function afterMutation(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  opts: MutationOptions = {}
) {
  touchProject(ctx, projectId)
  ctx.realtime.broadcast(projectId, { type: 'tree.changed' })
  if (opts.emitChanged !== false)
    ctx.realtime.events.emit('changed', { projectId, userId })
}

function assertName(name: string) {
  const problem = validateEntryName(name)
  if (problem) throw badRequest(problem)
}

function assertSubtreePaths(
  ctx: AppContext,
  rows: EntryRow[],
  entry: EntryRow,
  parentId: string,
  name: string
) {
  const paths = buildPaths(rows)
  const oldPath = paths.get(entry.id) as string
  const parentPath = paths.get(parentId)
  const nextPath = parentPath ? `${parentPath}/${name}` : name
  assertMaterializablePath(ctx.config.dataDir, nextPath)
  if (entry.kind !== 'folder') return
  const oldPrefix = `${oldPath}/`
  for (const path of paths.values()) {
    if (path.startsWith(oldPrefix))
      assertMaterializablePath(
        ctx.config.dataDir,
        nextPath + path.slice(oldPath.length)
      )
  }
}

function requireEntry(rows: EntryRow[], id: string): EntryRow {
  const row = rows.find(r => r.id === id)
  if (!row) throw notFound('File or folder not found')
  return row
}

function requireFolder(rows: EntryRow[], id: string): EntryRow {
  const row = requireEntry(rows, id)
  if (row.kind !== 'folder') throw badRequest('Parent is not a folder')
  return row
}

function findChild(rows: EntryRow[], parentId: string, name: string) {
  return rows.find(r => r.parentId === parentId && r.name === name)
}

function assertNoClash(
  rows: EntryRow[],
  parentId: string,
  name: string,
  exceptId?: string
) {
  const existing = findChild(rows, parentId, name)
  if (existing && existing.id !== exceptId) {
    throw conflict(`"${name}" already exists in this folder`, {
      existingEntryId: existing.id,
    })
  }
}

function insertEntry(
  ctx: AppContext,
  rows: EntryRow[],
  values: Omit<
    EntryRow,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'size'
    | 'blobHash'
    | 'gitOid'
    | 'sourceUrl'
  > &
    Partial<Pick<EntryRow, 'size' | 'blobHash' | 'gitOid' | 'sourceUrl'>>
): EntryRow {
  const now = Date.now()
  const row: EntryRow = {
    id: crypto.randomUUID(),
    size: 0,
    blobHash: null,
    gitOid: null,
    sourceUrl: null,
    createdAt: now,
    updatedAt: now,
    ...values,
  }
  ctx.db.insert(entries).values(row).run()
  rows.push(row)
  return row
}
/** Commits SQL and encoded Y state together, then publishes the validated update. */
function commitTreeState(
  ctx: AppContext,
  projectId: string,
  live: Y.Doc,
  projected: Y.Doc | null,
  applySQL: () => void
) {
  const encoded = assertProjectStateWithinLimit(
    projected ?? live,
    ctx.config.maxProjectStateBytes
  )
  const state = Buffer.from(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength
  )
  const update = projected
    ? Y.encodeStateAsUpdate(projected, Y.encodeStateVector(live))
    : null
  ctx.db.transaction(() => {
    applySQL()
    ctx.db
      .insert(projectYdocs)
      .values({ projectId, state, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: projectYdocs.projectId,
        set: { state, updatedAt: Date.now() },
      })
      .run()
  })
  if (update) Y.applyUpdate(live, update)
}

/** Deletes SQL entries and their Y content in the same durable state commit. */
async function deleteInternal(
  ctx: AppContext,
  projectId: string,
  rows: EntryRow[],
  entryId: string
) {
  const ids = subtreeIds(rows, entryId)
  const removed = rows.filter(row => ids.has(row.id))
  const deleting = deletionOrder(removed)
  const docIds = new Set(
    removed.filter(row => row.kind === 'doc').map(row => row.id)
  )
  const project = ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) throw notFound('Project not found')
  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: Date.now() }
  if (project.rootDocId && ids.has(project.rootDocId)) patch.rootDocId = null
  if (project.mainBibDocId && ids.has(project.mainBibDocId))
    patch.mainBibDocId = null
  await ctx.realtime.withProjectDoc(projectId, live => {
    const projected = docIds.size > 0 ? new Y.Doc() : null
    try {
      if (projected) {
        Y.applyUpdate(projected, Y.encodeStateAsUpdate(live))
        projected.clientID = live.clientID
        const texts = projected.getMap<Y.Text>(YDOC_TEXTS)
        for (const id of docIds) texts.delete(id)
        for (const key of [YDOC_COMMENTS, YDOC_CHANGES]) {
          const map = projected.getMap<Y.Map<unknown>>(key)
          for (const [id, anchor] of map)
            if (docIds.has(anchor.get('docId') as string)) map.delete(id)
        }
      }
      commitTreeState(ctx, projectId, live, projected, () => {
        const deleted = [...docIds]
        for (let i = 0; i < deleted.length; i += 500)
          ctx.db
            .delete(commentThreads)
            .where(
              and(
                eq(commentThreads.projectId, projectId),
                inArray(commentThreads.docId, deleted.slice(i, i + 500))
              )
            )
            .run()
        for (const id of deleting)
          ctx.db.delete(entries).where(eq(entries.id, id)).run()
        ctx.db
          .update(projects)
          .set(patch)
          .where(eq(projects.id, projectId))
          .run()
      })
    } finally {
      projected?.destroy()
    }
  })
  if (patch.rootDocId === null || patch.mainBibDocId === null)
    ctx.realtime.broadcast(projectId, { type: 'project.updated' })
  if (docIds.size > 0)
    ctx.realtime.broadcast(projectId, { type: 'comments.changed' })
  await deleteBlobsIfUnreferenced(
    ctx.db,
    ctx.config.dataDir,
    removed.flatMap(row => (row.blobHash ? [row.blobHash] : []))
  )
}

export async function createEntry(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  input: { parentId: string; name: string; kind: 'folder' | 'doc' },
  opts?: MutationOptions
): Promise<TreeEntry> {
  const row = await projectLock(projectId).runExclusive(async () => {
    const rows = loadEntries(ctx.db, projectId)
    requireFolder(rows, input.parentId)
    assertName(input.name)
    assertNoClash(rows, input.parentId, input.name)
    const paths = buildPaths(rows)
    const parentPath = paths.get(input.parentId)
    const path = parentPath ? `${parentPath}/${input.name}` : input.name
    assertMaterializablePath(ctx.config.dataDir, path)
    const created =
      input.kind === 'folder'
        ? insertEntry(ctx, rows, {
            projectId,
            parentId: input.parentId,
            name: input.name,
            kind: 'folder',
          })
        : ((
            await applyFilesLocked(
              ctx,
              projectId,
              new Map([[path, { kind: 'doc', text: '' }]]),
              false
            )
          ).get(path) as EntryRow)
    afterMutation(ctx, projectId, userId, opts)
    return created
  })
  return toTreeEntry(row)
}

export type IncomingFile = { name: string; content: IncomingContent }

export async function uploadFiles(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  input: {
    parentId: string
    overwrite: boolean
    files: IncomingFile[]
    sourceUrl?: string
  },
  opts?: MutationOptions
): Promise<TreeEntry[]> {
  try {
    const result = await projectLock(projectId).runExclusive(async () => {
      const rows = loadEntries(ctx.db, projectId)
      requireFolder(rows, input.parentId)
      const names = new Set<string>()
      for (const file of input.files) {
        assertName(file.name)
        if (names.has(file.name)) {
          throw badRequest(
            `"${file.name}" appears more than once in this upload`
          )
        }
        names.add(file.name)
      }
      const clashes = input.files
        .map(f => ({
          name: f.name,
          existing: findChild(rows, input.parentId, f.name),
        }))
        .filter(c => c.existing)
      // With overwrite, any clash is replaced (a kind mismatch, including a
      // folder, gets full delete semantics before the new entry is created).
      if (clashes.length > 0 && !input.overwrite) {
        const [first] = clashes
        throw conflict(`"${first.name}" already exists in this folder`, {
          existingEntryId: first.existing?.id,
          conflicts: clashes.map(c => ({
            name: c.name,
            existingEntryId: c.existing?.id,
          })),
        })
      }
      const paths = buildPaths(rows)
      const parentPath = paths.get(input.parentId)
      const incoming = new Map<string, IncomingContent>()
      const sourceUrls = new Map<string, string | null>()
      for (const file of input.files) {
        const path = parentPath ? `${parentPath}/${file.name}` : file.name
        assertMaterializablePath(ctx.config.dataDir, path)
        incoming.set(path, file.content)
        sourceUrls.set(path, input.sourceUrl ?? null)
      }
      const written = await applyFilesLocked(
        ctx,
        projectId,
        incoming,
        false,
        sourceUrls
      )
      afterMutation(ctx, projectId, userId, opts)
      return Array.from(written.values(), toTreeEntry)
    })
    return result
  } finally {
    for (const file of input.files) {
      if (file.content.kind === 'file')
        await releaseBlob(ctx.db, ctx.config.dataDir, file.content.blob)
    }
  }
}

/** Re-fetched linked file: overwrite semantics into the same name/folder. */
export async function replaceEntryContent(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  entryId: string,
  content: IncomingContent,
  sourceUrl: string | null,
  opts?: MutationOptions
): Promise<TreeEntry> {
  try {
    const row = await projectLock(projectId).runExclusive(async () => {
      const rows = loadEntries(ctx.db, projectId)
      const entry = requireEntry(rows, entryId)
      if (entry.kind === 'folder' || entry.parentId === null)
        throw badRequest('Not a file')
      const paths = buildPaths(rows)
      const path = paths.get(entry.id) as string
      const updated = (
        await applyFilesLocked(
          ctx,
          projectId,
          new Map([[path, content]]),
          false,
          new Map([[path, sourceUrl]])
        )
      ).get(path) as EntryRow
      afterMutation(ctx, projectId, userId, opts)
      return updated
    })
    return toTreeEntry(row)
  } finally {
    if (content.kind === 'file')
      await releaseBlob(ctx.db, ctx.config.dataDir, content.blob)
  }
}

export async function renameEntry(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  entryId: string,
  name: string,
  opts?: MutationOptions
): Promise<TreeEntry> {
  const row = await projectLock(projectId).runExclusive(async () => {
    const rows = loadEntries(ctx.db, projectId)
    const entry = requireEntry(rows, entryId)
    if (entry.parentId === null)
      throw badRequest('The root folder cannot be renamed')
    assertName(name)
    assertNoClash(rows, entry.parentId, name, entry.id)
    assertSubtreePaths(ctx, rows, entry, entry.parentId, name)
    const updatedAt = Date.now()
    const settingsChanged = ctx.db.transaction(tx => {
      tx.update(entries)
        .set({ name, updatedAt })
        .where(eq(entries.id, entry.id))
        .run()
      let changed = false
      if (!name.toLowerCase().endsWith('.tex'))
        changed =
          tx
            .update(projects)
            .set({ rootDocId: null })
            .where(
              and(eq(projects.id, projectId), eq(projects.rootDocId, entry.id))
            )
            .run().changes > 0
      if (!name.toLowerCase().endsWith('.bib'))
        changed =
          tx
            .update(projects)
            .set({ mainBibDocId: null })
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.mainBibDocId, entry.id)
              )
            )
            .run().changes > 0 || changed
      return changed
    })
    if (settingsChanged)
      ctx.realtime.broadcast(projectId, { type: 'project.updated' })
    afterMutation(ctx, projectId, userId, opts)
    return { ...entry, name, updatedAt }
  })
  return toTreeEntry(row)
}

export async function moveEntry(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  entryId: string,
  parentId: string,
  opts?: MutationOptions
): Promise<TreeEntry> {
  const row = await projectLock(projectId).runExclusive(async () => {
    const rows = loadEntries(ctx.db, projectId)
    const entry = requireEntry(rows, entryId)
    if (entry.parentId === null)
      throw badRequest('The root folder cannot be moved')
    requireFolder(rows, parentId)
    if (subtreeIds(rows, entry.id).has(parentId)) {
      throw badRequest('A folder cannot be moved into itself')
    }
    assertNoClash(rows, parentId, entry.name, entry.id)
    assertSubtreePaths(ctx, rows, entry, parentId, entry.name)
    const updatedAt = Date.now()
    ctx.db
      .update(entries)
      .set({ parentId, updatedAt })
      .where(eq(entries.id, entry.id))
      .run()
    afterMutation(ctx, projectId, userId, opts)
    return { ...entry, parentId, updatedAt }
  })
  return toTreeEntry(row)
}

export async function deleteEntry(
  ctx: AppContext,
  projectId: string,
  userId: string | null,
  entryId: string,
  opts?: MutationOptions
) {
  await projectLock(projectId).runExclusive(async () => {
    const rows = loadEntries(ctx.db, projectId)
    const entry = requireEntry(rows, entryId)
    if (entry.parentId === null)
      throw badRequest('The root folder cannot be deleted')
    await deleteInternal(ctx, projectId, rows, entry.id)
    afterMutation(ctx, projectId, userId, opts)
  })
}

export type ProjectFileContent =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; hash: string; size: number; gitOid: string }

/**
 * Makes the project tree match `files` (keyed by path). Used by history
 * restore and git push import; writes Y as `{ system: true }` and does not
 * mark history dirty.
 */
export function applyTreeToProject(
  ctx: AppContext,
  projectId: string,
  files: Map<string, ProjectFileContent>,
  options: { deleteMissing: boolean }
): Promise<void> {
  return projectLock(projectId).runExclusive(() =>
    applyTreeToProjectLocked(ctx, projectId, files, options)
  )
}

/** Applies a prevalidated file batch atomically while the caller holds projectLock. */
async function applyFilesLocked(
  ctx: AppContext,
  projectId: string,
  incoming: Map<string, IncomingContent>,
  deleteMissing: boolean,
  sourceUrls?: ReadonlyMap<string, string | null>
): Promise<Map<string, EntryRow>> {
  const wantedDirs = new Set<string>([''])
  for (const path of incoming.keys()) {
    const parts = path.split('/')
    for (const segment of parts) assertName(segment)
    assertMaterializablePath(ctx.config.dataDir, path)
    for (let i = 1; i < parts.length; i++)
      wantedDirs.add(parts.slice(0, i).join('/'))
  }
  for (const path of incoming.keys())
    if (wantedDirs.has(path))
      throw badRequest(`"${path}" cannot be both a file and a folder`)

  const rows = loadEntries(ctx.db, projectId)
  const root = rows.find(row => row.parentId === null)
  const project = ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!root || !project) throw notFound('Project not found')
  const paths = buildPaths(rows)
  const before = new Map(rows.map(row => [paths.get(row.id) as string, row]))
  if (!deleteMissing) {
    for (const dir of wantedDirs) {
      const row = before.get(dir)
      if (row && row.kind !== 'folder')
        throw conflict(`"${dir}" is a file, expected a folder`)
    }
  }
  const removed: EntryRow[] = []
  const after = new Map<string, EntryRow>()
  for (const [path, row] of before) {
    const next = incoming.get(path)
    let remove =
      row.parentId !== null &&
      ((deleteMissing &&
        (row.kind === 'folder' ? !wantedDirs.has(path) : !next)) ||
        (next !== undefined && row.kind !== next.kind))
    for (
      let slash = path.lastIndexOf('/');
      !remove && slash > 0;
      slash = path.lastIndexOf('/', slash - 1)
    )
      if (incoming.has(path.slice(0, slash))) remove = true
    if (remove) removed.push(row)
    else after.set(path, row)
  }
  const now = Date.now()
  const inserted: EntryRow[] = []
  const updated: EntryRow[] = []
  const newRow = (
    parentId: string,
    name: string,
    kind: EntryRow['kind']
  ): EntryRow => ({
    id: crypto.randomUUID(),
    projectId,
    parentId,
    name,
    kind,
    size: 0,
    blobHash: null,
    gitOid: null,
    sourceUrl: null,
    createdAt: now,
    updatedAt: now,
  })
  for (const dir of wantedDirs) {
    if (after.has(dir)) continue
    const slash = dir.lastIndexOf('/')
    const parent = after.get(slash === -1 ? '' : dir.slice(0, slash))
    if (!parent) throw new Error('Missing planned parent folder')
    const row = newRow(parent.id, dir.slice(slash + 1), 'folder')
    inserted.push(row)
    after.set(dir, row)
  }
  const result = new Map<string, EntryRow>()
  for (const [path, content] of incoming) {
    let row = after.get(path)
    const existing = before.get(path)
    const sourceUrl = sourceUrls?.has(path)
      ? (sourceUrls.get(path) ?? null)
      : (existing?.sourceUrl ?? null)
    if (!row) {
      const slash = path.lastIndexOf('/')
      const parent = after.get(slash === -1 ? '' : path.slice(0, slash))
      if (!parent) throw new Error('Missing planned parent folder')
      row = newRow(parent.id, path.slice(slash + 1), content.kind)
      inserted.push(row)
    } else if (
      content.kind === 'doc' ||
      row.blobHash !== content.blob.hash ||
      sourceUrls?.has(path)
    ) {
      row = { ...row }
      updated.push(row)
    } else {
      result.set(path, row)
      continue
    }
    Object.assign(
      row,
      content.kind === 'doc'
        ? { size: Buffer.byteLength(content.text), sourceUrl, updatedAt: now }
        : {
            size: content.blob.size,
            blobHash: content.blob.hash,
            gitOid: content.blob.gitOid,
            sourceUrl,
            updatedAt: now,
          }
    )
    after.set(path, row)
    result.set(path, row)
  }
  const removedIds = new Set(removed.map(row => row.id))
  const deleting = deletionOrder(removed)
  const removedDocIds = new Set(
    removed.filter(row => row.kind === 'doc').map(row => row.id)
  )
  const docIdsByPath = new Map<string, string>()
  for (const [path, row] of before)
    if (row.kind === 'doc') docIdsByPath.set(path, row.id)
  for (const [path, row] of after)
    if (row.kind === 'doc') docIdsByPath.set(path, row.id)
  const projectPatch: Partial<typeof projects.$inferInsert> = { updatedAt: now }
  if (project.rootDocId && removedIds.has(project.rootDocId))
    projectPatch.rootDocId = null
  if (project.mainBibDocId && removedIds.has(project.mainBibDocId))
    projectPatch.mainBibDocId = null
  await ctx.realtime.withProjectDoc(projectId, live => {
    const projected = projectYState(live, docIdsByPath, incoming, deleteMissing)
    try {
      commitTreeState(ctx, projectId, live, projected, () => {
        if (removedDocIds.size > 0) {
          const ids = [...removedDocIds]
          for (let i = 0; i < ids.length; i += 500)
            ctx.db
              .delete(commentThreads)
              .where(
                and(
                  eq(commentThreads.projectId, projectId),
                  inArray(commentThreads.docId, ids.slice(i, i + 500))
                )
              )
              .run()
        }
        for (const id of deleting)
          ctx.db.delete(entries).where(eq(entries.id, id)).run()
        for (const row of inserted) ctx.db.insert(entries).values(row).run()
        for (const row of updated)
          ctx.db
            .update(entries)
            .set({
              size: row.size,
              blobHash: row.blobHash,
              gitOid: row.gitOid,
              sourceUrl: row.sourceUrl,
              updatedAt: row.updatedAt,
            })
            .where(eq(entries.id, row.id))
            .run()
        ctx.db
          .update(projects)
          .set(projectPatch)
          .where(eq(projects.id, projectId))
          .run()
      })
    } finally {
      projected?.destroy()
    }
  })
  if (projectPatch.rootDocId === null || projectPatch.mainBibDocId === null)
    ctx.realtime.broadcast(projectId, { type: 'project.updated' })
  if (removedDocIds.size > 0)
    ctx.realtime.broadcast(projectId, { type: 'comments.changed' })
  const garbage = new Set<string>()
  for (const row of removed) if (row.blobHash) garbage.add(row.blobHash)
  for (const row of updated) {
    const oldHash = before.get(paths.get(row.id) as string)?.blobHash
    if (oldHash && oldHash !== row.blobHash) garbage.add(oldHash)
  }
  await deleteBlobsIfUnreferenced(ctx.db, ctx.config.dataDir, garbage)
  return result
}

/** Caller holds projectLock across snapshot preservation and tree replacement. */
export async function applyTreeToProjectLocked(
  ctx: AppContext,
  projectId: string,
  files: Map<string, ProjectFileContent>,
  { deleteMissing }: { deleteMissing: boolean }
) {
  try {
    const incoming = new Map<string, IncomingContent>()
    for (const [path, file] of files)
      incoming.set(
        path,
        file.kind === 'text'
          ? { kind: 'doc', text: file.text }
          : { kind: 'file', blob: file }
      )
    await applyFilesLocked(ctx, projectId, incoming, deleteMissing)
    ctx.realtime.broadcast(projectId, { type: 'tree.changed' })
  } finally {
    for (const file of files.values())
      if (file.kind === 'binary')
        await releaseBlob(ctx.db, ctx.config.dataDir, file)
  }
}
