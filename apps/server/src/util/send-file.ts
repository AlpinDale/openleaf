import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    sendFileHeaders: Record<string, string> | null
  }
}

/**
 * Registers @fastify/static for `reply.sendFile` (Range support) without
 * serving anything. User content is sent with a sandboxing CSP so an uploaded
 * SVG/HTML file can't run script on our origin.
 */
export async function installSendFile(app: FastifyInstance) {
  app.decorateRequest('sendFileHeaders', null)
  await app.register(fastifyStatic, {
    root: app.ctx.config.dataDir,
    serve: false,
    decorateReply: true,
    setHeaders(reply) {
      const extra = reply.request.sendFileHeaders
      if (extra) reply.headers(extra)
    },
  })
}

export function sendFile(
  reply: FastifyReply,
  rel: string,
  root: string,
  headers: Record<string, string>
) {
  reply.request.sendFileHeaders = {
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    ...headers,
  }
  return reply.sendFile(rel, root)
}
