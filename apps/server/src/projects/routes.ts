import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  CopyProjectBody,
  CreateProjectBody,
  findSpellLanguage,
  PatchProjectBody,
} from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireProjectRole, requireUser, userOf } from '../auth/plugin.js'
import { entries, projects } from '../db/schema.js'
import { badRequest, forbidden, HttpError, parse, tooLarge } from '../errors.js'
import { releaseBlob } from '../tree/blobs.js'
import { projectLock } from '../tree/locks.js'
import { projectSnapshotLocked } from '../tree/snapshot.js'
import {
  assertProjectNotDeleting,
  copyProject,
  createProjectFromFiles,
  deleteProject,
  listProjects,
  type NewProjectFile,
  projectDetails,
  templateFiles,
} from './service.js'
import {
  attachmentHeader,
  readProjectZip,
  zipEntries,
  zipFilename,
} from './zip.js'

export async function projectRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  const { db } = ctx

  app.get('/projects', { preHandler: requireUser }, async request => {
    return { projects: listProjects(ctx, userOf(request).id) }
  })

  app.post('/projects', { preHandler: requireUser }, async (request, reply) => {
    const body = parse(CreateProjectBody, request.body)
    const user = userOf(request)
    const id = await createProjectFromFiles(ctx, {
      ownerId: user.id,
      name: body.name,
      files: templateFiles(body.template, {
        title: body.name,
        author: user.name,
      }),
      rootDocPath: 'main.tex',
      source: 'create',
    })
    return reply.status(201).send({ id })
  })

  app.post(
    '/projects/import',
    { preHandler: requireUser },
    async (request, reply) => {
      const user = userOf(request)
      const file = await request.file({
        limits: { fileSize: ctx.config.maxUploadBytes * 6, files: 1 },
      })
      if (!file) throw badRequest('Missing zip file')
      const tmpDir = path.join(ctx.config.dataDir, 'tmp')
      await fsp.mkdir(tmpDir, { recursive: true })
      const tmp = path.join(tmpDir, `${crypto.randomUUID()}.zip`)
      let imported: NewProjectFile[] = []
      try {
        await pipeline(file.file, fs.createWriteStream(tmp))
        if (file.file.truncated) throw tooLarge('The uploaded zip is too large')
        const { files, emptyFolders } = await readProjectZip(
          ctx,
          tmp,
          request.log
        )
        imported = files
        const base = path
          .basename(file.filename || 'project.zip')
          .replace(/\.zip$/i, '')
        const name = base.trim().slice(0, 150) || 'Imported project'
        const id = await createProjectFromFiles(ctx, {
          ownerId: user.id,
          name,
          files,
          emptyFolders,
          source: 'import',
          message: `Import ${path.basename(file.filename || 'project.zip')}`,
        })
        return reply.status(201).send({ id })
      } finally {
        for (const file of imported) {
          if (file.content.kind === 'file')
            await releaseBlob(db, ctx.config.dataDir, file.content.blob)
        }
        await fsp.rm(tmp, { force: true })
      }
    }
  )

  app.get(
    '/projects/:id',
    { preHandler: requireProjectRole('viewer') },
    async request => {
      const now = Date.now()
      db.update(projects)
        .set({ lastOpenedAt: now })
        .where(eq(projects.id, request.project.id))
        .run()
      return projectDetails(
        ctx,
        { ...request.project, lastOpenedAt: now },
        request.role
      )
    }
  )

  app.patch(
    '/projects/:id',
    { preHandler: requireProjectRole('editor') },
    async request => {
      const body = parse(PatchProjectBody, request.body)
      const project = request.project
      if (body.name !== undefined && request.role !== 'owner') {
        throw forbidden('Only the owner can rename the project')
      }
      return projectLock(project.id).runExclusive(() => {
        assertProjectNotDeleting(ctx, project.id)
        const existing = db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, project.id))
          .get()
        if (!existing)
          throw new HttpError(404, 'not_found', 'Project not found')
        if (body.rootDocId) {
          const doc = db
            .select({
              projectId: entries.projectId,
              kind: entries.kind,
              name: entries.name,
            })
            .from(entries)
            .where(eq(entries.id, body.rootDocId))
            .get()
          if (
            !doc ||
            doc.projectId !== project.id ||
            doc.kind !== 'doc' ||
            !doc.name.toLowerCase().endsWith('.tex')
          ) {
            throw badRequest(
              'Main document must be a .tex document in this project'
            )
          }
        }
        if (body.mainBibDocId) {
          const bib = db
            .select({
              projectId: entries.projectId,
              kind: entries.kind,
              name: entries.name,
            })
            .from(entries)
            .where(eq(entries.id, body.mainBibDocId))
            .get()
          if (
            !bib ||
            bib.projectId !== project.id ||
            bib.kind !== 'doc' ||
            !bib.name.toLowerCase().endsWith('.bib')
          ) {
            throw badRequest(
              'Main bibliography must be a .bib document in this project'
            )
          }
        }
        if (
          body.image !== undefined &&
          !ctx.config.texliveImages.includes(body.image)
        ) {
          throw badRequest('Unknown TeX Live image')
        }
        if (
          body.spellLanguage !== undefined &&
          body.spellLanguage !== '' &&
          !findSpellLanguage(body.spellLanguage)
        ) {
          throw badRequest('Unknown spell check language')
        }
        const patch = { ...body, updatedAt: Date.now() }
        db.update(projects).set(patch).where(eq(projects.id, project.id)).run()
        ctx.realtime.broadcast(project.id, { type: 'project.updated' })
        const updated = db
          .select()
          .from(projects)
          .where(eq(projects.id, project.id))
          .get()
        if (!updated) throw new HttpError(404, 'not_found', 'Project not found')
        return projectDetails(ctx, updated, request.role)
      })
    }
  )

  app.post(
    '/projects/:id/copy',
    { preHandler: requireProjectRole('viewer') },
    async (request, reply) => {
      const body = parse(CopyProjectBody, request.body)
      const id = await copyProject(
        ctx,
        request.project,
        userOf(request).id,
        body.name
      )
      return reply.status(201).send({ id })
    }
  )

  const setFlag = (
    action: string,
    column: 'archivedAt' | 'trashedAt',
    value: () => number | null
  ) => {
    app.post(
      `/projects/:id/${action}`,
      { preHandler: requireProjectRole('owner') },
      async request => {
        await projectLock(request.project.id).runExclusive(() => {
          assertProjectNotDeleting(ctx, request.project.id)
          const changed = db
            .update(projects)
            .set({ [column]: value() })
            .where(eq(projects.id, request.project.id))
            .run()
          if (changed.changes === 0)
            throw new HttpError(404, 'not_found', 'Project not found')
          ctx.realtime.broadcast(request.project.id, {
            type: 'project.updated',
          })
        })
        return { ok: true }
      }
    )
  }
  setFlag('archive', 'archivedAt', () => Date.now())
  setFlag('unarchive', 'archivedAt', () => null)
  setFlag('trash', 'trashedAt', () => Date.now())
  setFlag('restore', 'trashedAt', () => null)

  app.delete(
    '/projects/:id',
    { preHandler: requireProjectRole('owner') },
    async request => {
      const current = db
        .select({ trashedAt: projects.trashedAt })
        .from(projects)
        .where(eq(projects.id, request.project.id))
        .get()
      if (!current) throw new HttpError(404, 'not_found', 'Project not found')
      if (current.trashedAt === null) {
        throw badRequest('Only trashed projects can be deleted')
      }
      await deleteProject(ctx, request.project.id)
      return { ok: true }
    }
  )

  app.get(
    '/projects/:id/download.zip',
    { preHandler: requireProjectRole('viewer') },
    async (request, reply) => {
      const release = await projectLock(request.project.id).acquire()
      try {
        const snapshot = await projectSnapshotLocked(ctx, request.project.id)
        reply
          .header('content-type', 'application/zip')
          .header(
            'content-disposition',
            attachmentHeader(zipFilename(request.project.name))
          )
        const stream = zipEntries(ctx, snapshot.entries)
        stream.once('end', release)
        stream.once('close', release)
        return reply.send(stream)
      } catch (err) {
        release()
        throw err
      }
    }
  )
}
