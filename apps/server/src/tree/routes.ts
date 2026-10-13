import { Readable } from 'node:stream'
import {
  CreateEntryBody,
  ImportProjectFileBody,
  ImportUrlBody,
  MoveEntryBody,
  RenameEntryBody,
  validateEntryName,
  YDOC_TEXTS,
} from '@openleaf/shared'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type * as Y from 'yjs'
import {
  getMembership,
  isUuid,
  requireProjectRole,
  userOf,
} from '../auth/plugin.js'
import { entries } from '../db/schema.js'
import { badRequest, notFound, parse, tooLarge } from '../errors.js'
import { contentTypeFor } from '../util/mime.js'
import { sendFile } from '../util/send-file.js'
import { blobRelPath, blobsDir, releaseBlob, retainBlob } from './blobs.js'
import { fetchPublicUrl } from './fetch-url.js'
import { projectLock } from './locks.js'
import {
  contentFromBytes,
  contentFromStream,
  createEntry,
  deleteEntry,
  type IncomingContent,
  type IncomingFile,
  listTree,
  moveEntry,
  renameEntry,
  replaceEntryContent,
  uploadFiles,
} from './service.js'

type EntryParams = { id: string; eid: string }

export async function treeRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  const { db } = ctx
  const viewer = { preHandler: requireProjectRole('viewer') }
  const editor = { preHandler: requireProjectRole('editor') }

  app.get('/projects/:id/tree', viewer, async request =>
    listTree(ctx, request.project.id)
  )

  app.post('/projects/:id/entries', editor, async (request, reply) => {
    const body = parse(CreateEntryBody, request.body)
    const entry = await createEntry(
      ctx,
      request.project.id,
      userOf(request).id,
      body
    )
    return reply.status(201).send({ entry })
  })

  app.post('/projects/:id/upload', editor, async request => {
    let parentId: string | undefined
    let overwrite = false
    const files: IncomingFile[] = []
    let invalidName: string | null = null
    let docBytes = 0
    let uploadBytes = 0
    // Match ZIP imports: one batch may contain at most six per-file limits.
    const maxBatchBytes = ctx.config.maxUploadBytes * 6
    try {
      for await (const part of request.parts({
        limits: { fileSize: ctx.config.maxUploadBytes, files: 200, fields: 10 },
      })) {
        if (part.type === 'field') {
          if (part.fieldname === 'parentId') parentId = String(part.value)
          else if (part.fieldname === 'overwrite')
            overwrite = part.value === 'true'
          continue
        }
        const counted = Readable.from(
          (async function* () {
            for await (const chunk of part.file) {
              uploadBytes += chunk.byteLength
              if (uploadBytes > maxBatchBytes)
                throw tooLarge('Uploaded files exceed aggregate size limit')
              yield chunk
            }
          })()
        )
        const name = part.filename
        const problem = validateEntryName(name)
        if (problem) {
          invalidName ??= `${name}: ${problem}`
          for await (const _chunk of counted) {
            // Drain invalid files under the same aggregate budget.
          }
          continue
        }
        const content = await contentFromStream(ctx, name, counted)
        files.push({ name, content })
        if (part.file.truncated)
          throw tooLarge('Uploaded file exceeds size limit')
        if (content.kind === 'doc') {
          docBytes += Buffer.byteLength(content.text)
          if (docBytes > ctx.config.maxProjectStateBytes)
            throw tooLarge('Uploaded documents exceed project state limit')
        }
      }
      if (invalidName) throw badRequest(invalidName)
      if (!parentId) throw badRequest('Missing parentId')
      if (files.length === 0) throw badRequest('No files uploaded')
      const result = await uploadFiles(
        ctx,
        request.project.id,
        userOf(request).id,
        {
          parentId,
          overwrite,
          files,
        }
      )
      return { entries: result }
    } catch (err) {
      await gcUnused(files)
      throw err
    }
  })

  async function gcUnused(files: IncomingFile[]) {
    for (const file of files) {
      if (file.content.kind === 'file')
        await releaseBlob(db, ctx.config.dataDir, file.content.blob)
    }
  }

  async function fetchContent(
    url: string,
    name: string
  ): Promise<IncomingContent> {
    const bytes = await fetchPublicUrl(url, ctx.config.maxUploadBytes)
    return contentFromBytes(ctx, name, bytes)
  }

  app.post(
    '/projects/:id/entries/import-url',
    editor,
    async (request, reply) => {
      const body = parse(ImportUrlBody, request.body)
      const problem = validateEntryName(body.name)
      if (problem) throw badRequest(problem)
      const content = await fetchContent(body.url, body.name)
      const files = [{ name: body.name, content }]
      try {
        const [entry] = await uploadFiles(
          ctx,
          request.project.id,
          userOf(request).id,
          {
            parentId: body.parentId,
            overwrite: body.overwrite,
            files,
            sourceUrl: body.url,
          }
        )
        return reply.status(201).send({ entry })
      } catch (err) {
        await gcUnused(files)
        throw err
      }
    }
  )

  app.post<{ Params: EntryParams }>(
    '/projects/:id/entries/:eid/refresh',
    editor,
    async request => {
      const entry = requireEntryRow(request.project.id, request.params.eid)
      if (!entry.sourceUrl) throw badRequest('This file is not linked to a URL')
      const content = await fetchContent(entry.sourceUrl, entry.name)
      try {
        const updated = await replaceEntryContent(
          ctx,
          request.project.id,
          userOf(request).id,
          entry.id,
          content,
          entry.sourceUrl
        )
        return { entry: updated }
      } catch (err) {
        await gcUnused([{ name: entry.name, content }])
        throw err
      }
    }
  )

  app.post(
    '/projects/:id/entries/import-project',
    editor,
    async (request, reply) => {
      const body = parse(ImportProjectFileBody, request.body)
      const user = userOf(request)
      if (
        !isUuid(body.sourceProjectId) ||
        !getMembership(app, body.sourceProjectId, user.id)
      ) {
        throw notFound('Source project not found')
      }
      const content = await projectLock(body.sourceProjectId).runExclusive(
        async (): Promise<IncomingContent> => {
          const source = requireEntryRow(
            body.sourceProjectId,
            body.sourceEntryId
          )
          if (source.kind === 'doc') {
            const text = await ctx.realtime.withProjectDoc(
              body.sourceProjectId,
              doc =>
                doc.getMap<Y.Text>(YDOC_TEXTS).get(source.id)?.toString() ?? ''
            )
            return { kind: 'doc', text }
          }
          if (source.kind === 'file' && source.blobHash && source.gitOid) {
            return {
              kind: 'file',
              blob: await retainBlob(ctx.config.dataDir, {
                hash: source.blobHash,
                size: source.size,
                gitOid: source.gitOid,
              }),
            }
          }
          throw badRequest('Only files can be imported')
        }
      )
      const [entry] = await uploadFiles(ctx, request.project.id, user.id, {
        parentId: body.parentId,
        overwrite: body.overwrite,
        files: [{ name: body.name, content }],
      })
      return reply.status(201).send({ entry })
    }
  )

  app.post<{ Params: EntryParams }>(
    '/projects/:id/entries/:eid/rename',
    editor,
    async request => {
      const body = parse(RenameEntryBody, request.body)
      const entry = await renameEntry(
        ctx,
        request.project.id,
        userOf(request).id,
        request.params.eid,
        body.name
      )
      return { entry }
    }
  )

  app.post<{ Params: EntryParams }>(
    '/projects/:id/entries/:eid/move',
    editor,
    async request => {
      const body = parse(MoveEntryBody, request.body)
      const entry = await moveEntry(
        ctx,
        request.project.id,
        userOf(request).id,
        request.params.eid,
        body.parentId
      )
      return { entry }
    }
  )

  app.delete<{ Params: EntryParams }>(
    '/projects/:id/entries/:eid',
    editor,
    async request => {
      await deleteEntry(
        ctx,
        request.project.id,
        userOf(request).id,
        request.params.eid
      )
      return { ok: true }
    }
  )

  app.get<{ Params: EntryParams }>(
    '/projects/:id/files/:eid',
    viewer,
    async (request, reply) => {
      const entry = requireEntryRow(request.project.id, request.params.eid)
      if (entry.kind === 'doc') {
        const text = await ctx.realtime.withProjectDoc(
          request.project.id,
          doc => doc.getMap<Y.Text>(YDOC_TEXTS).get(entry.id)?.toString() ?? ''
        )
        return reply
          .header('content-type', 'text/plain; charset=utf-8')
          .header('x-content-type-options', 'nosniff')
          .send(text)
      }
      if (entry.kind !== 'file' || !entry.blobHash)
        throw notFound('File not found')
      return sendFile(
        reply,
        blobRelPath(entry.blobHash),
        blobsDir(ctx.config.dataDir),
        {
          'content-type': contentTypeFor(entry.name),
          'cache-control': 'private, no-cache',
        }
      )
    }
  )

  function requireEntryRow(projectId: string, entryId: string) {
    const row = db
      .select()
      .from(entries)
      .where(and(eq(entries.id, entryId), eq(entries.projectId, projectId)))
      .get()
    if (!row) throw notFound('File not found')
    return row
  }
}
