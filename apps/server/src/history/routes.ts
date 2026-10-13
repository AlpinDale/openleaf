import type { Readable } from 'node:stream'
import { CreateLabelBody, RestoreBody } from '@openleaf/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import yazl from 'yazl'
import { z } from 'zod'
import { requireProjectRole, userOf } from '../auth/plugin.js'
import { historyLabels, users } from '../db/schema.js'
import { notFound, parse } from '../errors.js'
import { attachmentHeader, zipFilename } from '../projects/zip.js'
import { contentTypeFor } from '../util/mime.js'

const ListQuery = z.object({
  before: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
const FileQuery = z.object({ path: z.string().min(1) })

type OidParams = { id: string; oid: string }

export async function historyRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  const { db } = ctx
  const viewer = { preHandler: requireProjectRole('viewer') }
  const editor = { preHandler: requireProjectRole('editor') }

  app.get('/projects/:id/history', viewer, async request => {
    const query = parse(ListQuery, request.query)
    return {
      versions: await ctx.history.listVersions(request.project.id, query),
    }
  })

  app.get('/projects/:id/history/labels', viewer, async request => {
    const labels = db
      .select({
        id: historyLabels.id,
        name: historyLabels.name,
        commitOid: historyLabels.commitOid,
        createdAt: historyLabels.createdAt,
        userName: users.name,
      })
      .from(historyLabels)
      .leftJoin(users, eq(users.id, historyLabels.userId))
      .where(eq(historyLabels.projectId, request.project.id))
      .orderBy(asc(historyLabels.createdAt))
      .all()
      .map(l => ({ ...l, userName: l.userName ?? 'Deleted user' }))
    return { labels }
  })

  app.post('/projects/:id/history/labels', editor, async (request, reply) => {
    const body = parse(CreateLabelBody, request.body)
    await ctx.history.versionBlobs(request.project.id, body.oid) // 404 for unknown versions
    const label = {
      id: crypto.randomUUID(),
      projectId: request.project.id,
      commitOid: body.oid,
      name: body.name,
      userId: userOf(request).id,
      createdAt: Date.now(),
    }
    db.insert(historyLabels).values(label).run()
    ctx.realtime.broadcast(request.project.id, {
      type: 'history.committed',
      oid: body.oid,
    })
    return reply.status(201).send({ label })
  })

  app.delete<{ Params: { id: string; lid: string } }>(
    '/projects/:id/history/labels/:lid',
    editor,
    async request => {
      const result = db
        .delete(historyLabels)
        .where(
          and(
            eq(historyLabels.id, request.params.lid),
            eq(historyLabels.projectId, request.project.id)
          )
        )
        .run()
      if (result.changes === 0) throw notFound('Label not found')
      return { ok: true }
    }
  )

  app.get<{ Params: OidParams }>(
    '/projects/:id/history/:oid/tree',
    viewer,
    async request => {
      return {
        files: await ctx.history.versionTree(
          request.project.id,
          request.params.oid
        ),
      }
    }
  )

  app.get<{ Params: OidParams }>(
    '/projects/:id/history/:oid/file',
    viewer,
    async (request, reply) => {
      const { path } = parse(FileQuery, request.query)
      const bytes = await ctx.history.versionFile(
        request.project.id,
        request.params.oid,
        path
      )
      return reply
        .header('content-type', contentTypeFor(path))
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(Buffer.from(bytes))
    }
  )

  app.post<{ Params: OidParams }>(
    '/projects/:id/history/:oid/restore',
    editor,
    async request => {
      const body = parse(RestoreBody, request.body ?? {})
      await ctx.history.restore(
        request.project.id,
        userOf(request).id,
        request.params.oid,
        body.path
      )
      return { ok: true }
    }
  )

  app.get<{ Params: OidParams }>(
    '/projects/:id/history/:oid/download.zip',
    viewer,
    async (request, reply) => {
      const projectId = request.project.id
      const blobs = await ctx.history.versionBlobs(
        projectId,
        request.params.oid
      )
      const zip = new yazl.ZipFile()
      for (const [path, blobOid] of blobs) {
        zip.addBuffer(
          Buffer.from(await ctx.history.readVersionBlob(projectId, blobOid)),
          path
        )
      }
      zip.end()
      const name = `${request.project.name} (${request.params.oid.slice(0, 7)})`
      reply
        .header('content-type', 'application/zip')
        .header('content-disposition', attachmentHeader(zipFilename(name)))
      return reply.send(zip.outputStream as unknown as Readable)
    }
  )
}
