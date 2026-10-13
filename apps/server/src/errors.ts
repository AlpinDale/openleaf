import type { ErrorCode } from '@openleaf/shared'
import type { FastifyError, FastifyInstance } from 'fastify'
import { ZodError, type z } from 'zod'

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

export const notFound = (message = 'Not found') =>
  new HttpError(404, 'not_found', message)
export const forbidden = (message = 'Forbidden') =>
  new HttpError(403, 'forbidden', message)
export const badRequest = (message: string) =>
  new HttpError(400, 'validation', message)
export const conflict = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(409, 'conflict', message, extra)
export const tooLarge = (message = 'Too large') =>
  new HttpError(413, 'too_large', message)

export function parse<T extends z.ZodType>(
  schema: T,
  value: unknown
): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw zodToHttp(result.error)
  return result.data
}

function zodToHttp(error: ZodError): HttpError {
  const issue = error.issues[0]
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  return badRequest(`${where}${issue?.message ?? 'Invalid request'}`)
}

const FASTIFY_CODES: Record<string, [number, ErrorCode]> = {
  FST_REQ_FILE_TOO_LARGE: [413, 'too_large'],
  FST_PARTS_LIMIT: [413, 'too_large'],
  FST_FILES_LIMIT: [413, 'too_large'],
  FST_FIELDS_LIMIT: [413, 'too_large'],
  FST_ERR_CTP_INVALID_JSON_BODY: [400, 'validation'],
  FST_ERR_CTP_BODY_TOO_LARGE: [413, 'too_large'],
  FST_ERR_CTP_INVALID_MEDIA_TYPE: [400, 'validation'],
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: [400, 'validation'],
  FST_INVALID_MULTIPART_CONTENT_TYPE: [400, 'validation'],
}

/** Paths that are never answered with the SPA's index.html. */
const NON_SPA_PATH = /^\/(api|collab|git|dictionaries|vendor)(\/|$|\?)/

/**
 * JSON errors everywhere; with `spaRoot`, unknown GETs outside the API fall
 * back to the web app's index.html (client-side routing).
 */
export function installErrorHandler(
  app: FastifyInstance,
  { spaRoot }: { spaRoot: string | null }
) {
  app.setErrorHandler((err: FastifyError | Error, request, reply) => {
    let status = 500
    let code: ErrorCode = 'internal'
    let message = 'Internal server error'
    let extra: Record<string, unknown> = {}
    if (err instanceof HttpError) {
      status = err.statusCode
      code = err.code
      message = err.message
      extra = err.extra
    } else if (err instanceof ZodError) {
      const h = zodToHttp(err)
      status = h.statusCode
      code = h.code
      message = h.message
    } else {
      const fe = err as FastifyError
      const mapped = fe.code ? FASTIFY_CODES[fe.code] : undefined
      if (mapped) {
        ;[status, code] = mapped
        message = fe.message
      } else if (fe.statusCode === 429) {
        status = 429
        code = 'rate_limited'
        message = 'Too many requests'
      } else if (
        typeof fe.statusCode === 'number' &&
        fe.statusCode >= 400 &&
        fe.statusCode < 500
      ) {
        status = fe.statusCode
        code =
          status === 404
            ? 'not_found'
            : status === 413
              ? 'too_large'
              : 'validation'
        message = fe.message
      }
    }
    if (status >= 500) request.log.error({ err }, 'request failed')
    if (reply.sent || reply.raw.headersSent) return
    reply.status(status).send({ error: { ...extra, code, message } })
  })
  app.setNotFoundHandler((request, reply) => {
    if (
      spaRoot &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !NON_SPA_PATH.test(request.url)
    ) {
      // Applied by the send-file setHeaders hook, after @fastify/static's defaults.
      request.sendFileHeaders = { 'cache-control': 'no-cache' }
      return reply.sendFile('index.html', spaRoot)
    }
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `${request.method} ${request.url} not found`,
      },
    })
  })
}
