import websocket from '@fastify/websocket'
import { MAX_REALTIME_UPDATE_BYTES } from '@openleaf/shared'
import type { FastifyInstance } from 'fastify'
import { requireUser, userOf } from '../auth/plugin.js'
import { forbidden } from '../errors.js'
import type { SocketAttachment } from './socket-admission.js'

/** `GET /collab`: Hocuspocus over @fastify/websocket (mirrors @hocuspocus/server Server.ts). */
export async function realtimeRoutes(app: FastifyInstance) {
  const { hocuspocus, disconnectRevokedSessions } = app.ctx.realtime
  const { publicUrl } = app.ctx.config
  let acceptingMessages = true
  await app.register(websocket, {
    options: { maxPayload: MAX_REALTIME_UPDATE_BYTES + 64 * 1024 },
  })
  // Idle sockets must not keep receiving edits forever after session expiry.
  const sessionTimer = setInterval(disconnectRevokedSessions, 60_000)
  sessionTimer.unref()
  app.addHook('preClose', async () => {
    acceptingMessages = false
    clearInterval(sessionTimer)
  })
  app.get(
    '/collab',
    {
      websocket: true,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      preValidation: async request => {
        // Browser websockets carry cookies even when opened by another origin.
        // Nonbrowser clients may omit Origin, but cannot forge browser metadata.
        const origin = request.headers.origin
        if (
          request.headers['sec-fetch-site'] === 'cross-site' ||
          (origin !== undefined && origin !== new URL(publicUrl).origin)
        ) {
          throw forbidden('Websocket origin is not allowed')
        }
        await requireUser(request)
      },
    },
    (socket, request) => {
      const sessionId = request.sessionId
      if (!sessionId) {
        socket.close(4401, 'Not logged in')
        return
      }
      let attached: SocketAttachment
      try {
        attached = app.ctx.realtime.openSocket(
          userOf(request).id,
          sessionId,
          (code, reason) => socket.close(code, reason)
        )
      } catch {
        socket.close(4403, 'openleaf:rate-limited')
        return
      }
      let admitting = true
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue
        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
      headers.set('x-openleaf-internal-socket', attached.id)
      const fetchRequest = new Request(new URL(request.url, publicUrl), {
        headers,
      })
      const connection = hocuspocus.handleConnection(socket, fetchRequest)
      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        if (
          !acceptingMessages ||
          !admitting ||
          socket.readyState !== socket.OPEN
        )
          return
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        try {
          attached.admission.accept(bytes)
          connection.handleMessage(bytes)
        } catch (error) {
          admitting = false
          const reason =
            error &&
            typeof error === 'object' &&
            'reason' in error &&
            typeof error.reason === 'string'
              ? error.reason
              : 'openleaf:invalid-update'
          socket.close(4403, reason)
        }
      })
      socket.on('close', (code: number, reason: Buffer) => {
        connection.handleClose({ code, reason: reason.toString() })
        app.ctx.realtime.closeSocket(attached.id)
      })
      socket.on('error', err => request.log.warn({ err }, 'websocket error'))
    }
  )
}
