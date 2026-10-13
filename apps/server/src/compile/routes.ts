import path from 'node:path'
import { CompileBody } from '@openleaf/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireProjectRole, userOf } from '../auth/plugin.js'
import { notFound, parse } from '../errors.js'
import { buildPaths, loadEntries } from '../tree/model.js'
import { contentTypeFor } from '../util/mime.js'
import { sendFile } from '../util/send-file.js'
import { compileKey } from './materialize.js'
import { BUILD_ID_RE, buildsDir } from './service.js'

const SynctexCodeQuery = z.object({
  path: z.string().min(1),
  line: z.coerce.number().int().min(1),
  column: z.coerce.number().int().min(0).default(0),
})
const SynctexPdfQuery = z.object({
  page: z.coerce.number().int().min(1),
  h: z.coerce.number(),
  v: z.coerce.number(),
})
const WordcountQuery = z.object({ docId: z.string().optional() })

export async function compileRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  const viewer = { preHandler: requireProjectRole('viewer') }

  app.post('/projects/:id/compile', viewer, async request => {
    const body = parse(CompileBody, request.body ?? {})
    return ctx.compile.compile(request.project, userOf(request).id, body)
  })

  app.post('/projects/:id/compile/stop', viewer, async request => {
    await ctx.compile.stop(request.project.id, userOf(request).id)
    return { ok: true }
  })

  app.delete('/projects/:id/compile/cache', viewer, async request => {
    await ctx.compile.clearCache(request.project.id, userOf(request).id)
    return { ok: true }
  })

  app.get<{ Params: { id: string; buildId: string; '*': string } }>(
    '/projects/:id/builds/:buildId/files/*',
    viewer,
    async (request, reply) => {
      const { buildId } = request.params
      const rel = request.params['*']
      if (!BUILD_ID_RE.test(buildId) || !rel)
        throw notFound('Output file not found')
      const normalized = path.posix.normalize(rel)
      if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
        throw notFound('Output file not found')
      }
      const root = path.join(
        buildsDir(
          ctx.config.dataDir,
          compileKey(request.project.id, userOf(request).id)
        ),
        buildId
      )
      return sendFile(reply, normalized, root, {
        'content-type': contentTypeFor(normalized),
        'cache-control': 'no-store',
      })
    }
  )

  app.get('/projects/:id/synctex/code', viewer, async request => {
    const query = parse(SynctexCodeQuery, request.query)
    const pdf = await ctx.compile.synctexFromCode(
      request.project,
      userOf(request).id,
      query
    )
    return { pdf }
  })

  app.get('/projects/:id/synctex/pdf', viewer, async request => {
    const query = parse(SynctexPdfQuery, request.query)
    const rows = loadEntries(ctx.db, request.project.id)
    const paths = buildPaths(rows)
    const docPaths = new Set(
      rows.filter(r => r.kind === 'doc').map(r => paths.get(r.id) as string)
    )
    const code = await ctx.compile.synctexFromPdf(
      request.project,
      userOf(request).id,
      query,
      docPaths
    )
    return { code }
  })

  app.get('/projects/:id/wordcount', viewer, async request => {
    const query = parse(WordcountQuery, request.query)
    return ctx.compile.wordcount(
      request.project,
      userOf(request).id,
      query.docId
    )
  })
}
