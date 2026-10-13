import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { installAuth } from './auth/plugin.js'
import { authRoutes } from './auth/routes.js'
import { commentRoutes } from './comments/routes.js'
import { ImageAvailability } from './compile/images.js'
import { compileRoutes } from './compile/routes.js'
import { CompileService } from './compile/service.js'
import type { Config } from './config.js'
import type { AppContext } from './context.js'
import { openDb } from './db/index.js'
import { HttpError, installErrorHandler } from './errors.js'
import { exportRoutes } from './export/routes.js'
import { ExportService } from './export/service.js'
import { gitRoutes } from './git/routes.js'
import { historyRoutes } from './history/routes.js'
import { HistoryService } from './history/service.js'
import { projectRoutes } from './projects/routes.js'
import { createRealtime } from './realtime/hocuspocus.js'
import { realtimeRoutes } from './realtime/routes.js'
import { dictionaryRoutes } from './spelling/routes.js'
import { vendorRoutes, webDistRoot, webRoutes } from './static.js'
import { treeRoutes } from './tree/routes.js'
import { installSendFile } from './util/send-file.js'

const BODY_CONTENT_TYPES = ['application/json', 'multipart/form-data']

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'warn' : 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
    },
    trustProxy: config.trustProxy,
    bodyLimit: config.maxJsonBodyBytes,
    requestTimeout: config.requestTimeoutMs,
  })
  const db = openDb(config.dataDir)
  const realtime = createRealtime(db, config)
  const ctx = { config, db, realtime } as AppContext
  let images: ImageAvailability | undefined
  const shutdownFailures: unknown[] = []
  app.addHook('preClose', async () => {
    realtime.beginShutdown()
    const results = await Promise.allSettled([
      ctx.compile?.close(),
      ctx.exports?.close(),
      images?.close(),
    ])
    for (const result of results) {
      if (result.status === 'rejected') shutdownFailures.push(result.reason)
    }
  })
  app.addHook('onClose', async () => {
    try {
      await realtime.flushAll()
    } catch (error) {
      shutdownFailures.push(error)
    }
    try {
      await ctx.history?.flushAll()
    } catch (error) {
      shutdownFailures.push(error)
    }
    try {
      await ctx.history?.drainGarbageCollectors()
    } catch (error) {
      shutdownFailures.push(error)
    }
    db.$client.close()
    if (shutdownFailures.length) {
      throw new AggregateError(shutdownFailures, 'Failed to shut down cleanly')
    }
  })

  try {
    ctx.compile = new CompileService(ctx, app.log)
    if (config.compileRunner === 'docker') {
      images = new ImageAvailability(config.texliveImages, app.log)
      ctx.compile.imageGate = images.assertReady.bind(images)
    }
    ctx.history = new HistoryService(ctx, app.log)
    ctx.exports = new ExportService(ctx, app.log)
    app.decorate('ctx', ctx)
    app.decorateRequest('project', null as never)
    app.decorateRequest('role', null as never)

    const spaRoot = webDistRoot(config.webDist)
    installErrorHandler(app, { spaRoot })

    // Empty JSON bodies are allowed (e.g. POST /api/auth/logout) and parse as {}.
    app.removeContentTypeParser('application/json')
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        const text = (body as string).trim()
        if (text === '') return done(null, {})
        try {
          done(null, JSON.parse(text))
        } catch {
          done(
            new HttpError(400, 'validation', 'Malformed JSON body'),
            undefined
          )
        }
      }
    )

    // Reject browser requests from sibling origins too: SameSite cookies alone
    // do not isolate untrusted applications hosted on the same parent domain.
    app.addHook('onRequest', async (request, reply) => {
      reply.header('x-content-type-options', 'nosniff')
      reply.header('referrer-policy', 'same-origin')
      reply.header('x-frame-options', 'SAMEORIGIN')
      reply.header(
        'content-security-policy',
        "base-uri 'self'; object-src 'none'; frame-ancestors 'self'"
      )
      if (request.url.startsWith('/api/')) {
        reply.header('cache-control', 'no-store')
      }
      if (request.method === 'GET' || request.method === 'HEAD') return
      if (!request.url.startsWith('/api/')) return
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin !== undefined &&
          request.headers.origin !== config.publicUrl)
      ) {
        throw new HttpError(
          403,
          'forbidden',
          'Cross-origin requests are not allowed'
        )
      }
      const type = (request.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase()
      if (!BODY_CONTENT_TYPES.includes(type)) {
        throw new HttpError(
          400,
          'validation',
          'Content-Type must be application/json or multipart/form-data'
        )
      }
    })

    await app.register(cookie)
    await app.register(multipart, {
      limits: {
        fileSize: config.maxUploadBytes,
        files: 200,
        fields: 20,
        fieldSize: 1024 * 1024,
      },
    })
    await installSendFile(app)
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: () =>
        new HttpError(
          429,
          'rate_limited',
          'Too many requests, try again later'
        ),
    })
    installAuth(app)

    await app.register(
      async api => {
        await api.register(authRoutes)
        await api.register(projectRoutes)
        await api.register(treeRoutes)
        await api.register(compileRoutes)
        await api.register(commentRoutes)
        await api.register(historyRoutes)
        await api.register(exportRoutes)
      },
      { prefix: '/api' }
    )

    await app.register(realtimeRoutes)
    await ctx.history.start()
    await app.register(dictionaryRoutes)
    await app.register(gitRoutes)
    await app.register(vendorRoutes)
    if (spaRoot) await webRoutes(app, spaRoot)

    return app
  } catch (error) {
    try {
      await app.close()
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Startup and cleanup failed'
      )
    }
    throw error
  }
}
