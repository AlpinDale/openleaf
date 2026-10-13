import { type ChildProcess, spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import { roleAtLeast } from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getMembership, isUuid } from '../auth/plugin.js'
import { sha256Hex } from '../auth/tokens.js'
import { gitTokens, projects, users } from '../db/schema.js'
import { nativeGitCommand } from './native-command.js'

type Service = 'git-upload-pack' | 'git-receive-pack'

function unauthorized(reply: FastifyReply) {
  return reply
    .status(401)
    .header('www-authenticate', 'Basic realm="OpenLeaf"')
    .type('text/plain')
    .send(
      'Authentication required: use a Git token from Account settings as the password.\n'
    )
}

function plain(reply: FastifyReply, status: number, message: string) {
  return reply.status(status).type('text/plain').send(`${message}\n`)
}

/** Resolves the user from `Authorization: Basic` (any username, token as password). */
function tokenUser(app: FastifyInstance, request: FastifyRequest) {
  const header = request.headers.authorization
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const password = decoded.slice(decoded.indexOf(':') + 1)
  if (!password) return null
  const { db } = app.ctx
  const row = db
    .select({ id: gitTokens.id, userId: gitTokens.userId, name: users.name })
    .from(gitTokens)
    .innerJoin(users, eq(users.id, gitTokens.userId))
    .where(eq(gitTokens.tokenHash, sha256Hex(password)))
    .get()
  if (!row) return null
  db.update(gitTokens)
    .set({ lastUsedAt: Date.now() })
    .where(eq(gitTokens.id, row.id))
    .run()
  return { id: row.userId, name: row.name }
}

/** Git smart HTTP at `/git/<projectId>` via `git http-backend`. */
export async function gitRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  let closing = false
  const active = new Map<Promise<void>, () => void>()
  app.addHook('preClose', async () => {
    closing = true
    for (const stop of active.values()) stop()
    await Promise.allSettled(active.keys())
  })
  // Pack bodies are streamed straight to git.
  for (const type of [
    'application/x-git-upload-pack-request',
    'application/x-git-receive-pack-request',
  ]) {
    app.addContentTypeParser(type, (_request, payload, done) =>
      done(null, payload)
    )
  }

  app.all<{ Params: { projectId: string; '*': string } }>(
    '/git/:projectId/*',
    async (request, reply) => {
      const { projectId } = request.params
      const rest = request.params['*']
      const query = new URL(request.url, 'http://x').searchParams
      let service: Service | null = null
      if (rest === 'info/refs' && request.method === 'GET') {
        const requested = query.get('service')
        if (
          requested === 'git-upload-pack' ||
          requested === 'git-receive-pack'
        ) {
          service = requested
        }
      } else if (
        request.method === 'POST' &&
        (rest === 'git-upload-pack' || rest === 'git-receive-pack')
      ) {
        service = rest
      }
      if (!service || !isUuid(projectId)) return plain(reply, 404, 'Not found')
      if (closing) return plain(reply, 503, 'Server is shutting down')
      if (active.size >= ctx.config.maxConcurrentGitOperations)
        return plain(reply, 429, 'Too many Git requests')
      if (
        request.method === 'POST' &&
        request.headers['content-type']?.split(';')[0] !==
          `application/x-${service}-request`
      )
        return plain(reply, 415, 'Invalid Git request content type')
      if (Number(request.headers['content-length'] ?? 0) > 100 * 1024 * 1024)
        return plain(reply, 413, 'Git request exceeds 100 MiB')

      const user = tokenUser(app, request)
      if (!user) return unauthorized(reply)
      const membership = getMembership(app, projectId, user.id)
      if (!membership || membership.project.trashedAt !== null) {
        return plain(reply, 404, 'Repository not found')
      }
      const needed = service === 'git-receive-pack' ? 'editor' : 'viewer'
      if (!roleAtLeast(membership.role, needed)) {
        return plain(
          reply,
          403,
          'You do not have permission to push to this project'
        )
      }

      const isPush = service === 'git-receive-pack' && request.method === 'POST'
      // Hold repository lifetime/history lock through the backend and push import.

      const env: Record<string, string> = {
        GIT_PROJECT_ROOT: ctx.history.root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${projectId}.git/${rest}`,
        REQUEST_METHOD: request.method,
        QUERY_STRING: request.method === 'GET' ? `service=${service}` : '',
        REMOTE_USER: user.id,
        REMOTE_ADDR: request.ip,
        GIT_HTTP_MAX_REQUEST_BUFFER: '100M',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1',
        PATH: process.env.PATH ?? '/usr/bin:/bin',
      }
      if (process.platform === 'linux')
        env.OPENLEAF_GIT_PROCESS_MEMORY_BYTES = String(
          ctx.config.gitMemoryBytes
        )
      const headers = request.headers
      if (headers['content-type']) env.CONTENT_TYPE = headers['content-type']
      if (headers['content-length'])
        env.CONTENT_LENGTH = headers['content-length']
      if (headers['content-encoding']) {
        env.HTTP_CONTENT_ENCODING = String(headers['content-encoding'])
      }
      if (headers['git-protocol'])
        env.GIT_PROTOCOL = String(headers['git-protocol'])

      let child: ChildProcess | undefined
      let input: Transform | undefined
      let cancelled = false
      const stop = () => {
        if (cancelled) return
        cancelled = true
        if (input) {
          request.raw.unpipe(input)
          input.unpipe()
          input.destroy()
        }
        child?.stdin?.destroy()
        // A paused stdout pipe otherwise prevents ChildProcess 'close' after SIGKILL.
        child?.stdout?.resume()
        child?.stderr?.resume()
        if (!child?.pid) return
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
      const cancel = () => {
        stop()
        // Ending a response does not finish an incomplete HTTP request body.
        // Close its socket before Fastify waits for server.close().
        request.raw.destroy()
        reply.raw.destroy()
      }
      const res = reply.raw
      const requestClosed = new Promise<void>(resolve => {
        if (request.raw.closed) resolve()
        else request.raw.once('close', () => resolve())
      })
      const responseClosed = new Promise<void>(resolve => {
        if (res.closed) resolve()
        else res.once('close', () => resolve())
      })
      const abort = () => {
        if (!res.writableFinished) stop()
        // Git may reject a pack before consuming its remaining HTTP body.
        if (!request.raw.complete) request.raw.destroy()
      }
      request.raw.on('aborted', stop)
      request.raw.on('error', stop)
      res.on('close', abort)
      // Includes lock queue, request upload, pack generation and client backpressure.
      const timer = setTimeout(() => {
        stop()
        res.destroy(new Error('Git request timed out'))
      }, 5 * 60_000)
      const runBackend = async (): Promise<void> => {
        if (closing || cancelled) return
        if (
          !ctx.db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .get()
        )
          throw new Error('Project was deleted')
        reply.hijack()
        const command = nativeGitCommand(
          ['http-backend'],
          ctx.config.gitMemoryBytes
        )
        const backend = spawn(command.file, command.args, {
          env,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        child = backend
        let stderr = ''
        backend.stderr.on('data', (chunk: Buffer) => {
          const room = 64 * 1024 - Buffer.byteLength(stderr)
          if (room > 0) stderr += chunk.subarray(0, room).toString('utf8')
        })
        let bytes = 0
        input = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length
            if (bytes > 100 * 1024 * 1024) {
              stop()
              res.destroy(new Error('Git request exceeds 100 MiB'))
              callback(new Error('Git input limit reached'))
            } else callback(null, chunk)
          },
        })
        input.on('error', cancel)
        if (request.method === 'POST')
          request.raw.pipe(input).pipe(backend.stdin)
        else backend.stdin.end()
        backend.stdin.on('error', () => {
          if (input) {
            request.raw.unpipe(input)
            input.unpipe(backend.stdin)
          }
          // Rejections may close stdin before consuming an uploaded pack.
          if (!cancelled) request.raw.resume()
        })
        let headerBuffer = Buffer.alloc(0)
        let headersSent = false
        const write = (chunk: Buffer) => {
          if (res.destroyed || cancelled) return
          if (!res.write(chunk)) backend.stdout.pause()
        }
        const drain = () => backend.stdout.resume()
        res.on('drain', drain)
        backend.stdout.on('data', (chunk: Buffer) => {
          if (cancelled) return
          if (headersSent) {
            write(chunk)
            return
          }
          headerBuffer = Buffer.concat([headerBuffer, chunk])
          const text = headerBuffer.toString('latin1')
          const match = /\r?\n\r?\n/.exec(text)
          if (!match) {
            if (headerBuffer.length > 64 * 1024) {
              stop()
              res.destroy(new Error('Invalid Git response headers'))
            }
            return
          }
          if (match.index > 64 * 1024) {
            stop()
            res.destroy(new Error('Invalid Git response headers'))
            return
          }
          let status = 200
          const outHeaders: Record<string, string> = {}
          for (const line of text.slice(0, match.index).split(/\r?\n/)) {
            const colon = line.indexOf(':')
            if (colon === -1) continue
            const name = line.slice(0, colon).trim()
            const value = line.slice(colon + 1).trim()
            if (name.toLowerCase() === 'status')
              status = Number.parseInt(value, 10) || 200
            else outHeaders[name] = value
          }
          if (res.destroyed) return
          try {
            res.writeHead(status, outHeaders)
          } catch {
            stop()
            res.destroy()
            return
          }
          headersSent = true
          const body = headerBuffer.subarray(match.index + match[0].length)
          headerBuffer = Buffer.alloc(0)
          if (body.length) write(body)
        })
        const exitCode = await new Promise<number | null>(resolve => {
          backend.on('error', err => {
            request.log.error({ err }, 'git http-backend failed to start')
          })
          backend.on('close', code => resolve(code))
        })
        request.raw.unpipe(input)
        input.destroy()
        input = undefined
        res.off('drain', drain)
        if (!headersSent && !res.destroyed) {
          request.log.error(
            { exitCode, stderr },
            'git http-backend produced no headers'
          )
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end('git http-backend failed\n')
        }
        if (exitCode !== 0)
          request.log.warn(
            { exitCode, stderr, projectId },
            'git http-backend exited unsuccessfully'
          )
      }
      const task = Promise.resolve()
        .then(async () => {
          await ctx.history.ensureHead(projectId)
          // Clients always see the live state; a stale push then fails as non-fast-forward.
          if (service === 'git-upload-pack' || rest === 'info/refs') {
            await ctx.history.flush(projectId)
          }
          if (isPush) await ctx.history.receivePush(projectId, runBackend)
          else await ctx.history.lock(projectId).runExclusive(runBackend)
          if (!res.destroyed && !res.writableEnded) res.end()
        })
        .catch(err => {
          request.log.error({ err, projectId }, 'Git request failed')
          if (!res.destroyed && !res.writableEnded) {
            if (res.headersSent) res.destroy()
            else {
              reply.hijack()
              res.writeHead(500, { 'content-type': 'text/plain' })
              res.end('Git request failed\n')
            }
          }
        })
        .then(async () => {
          // Keep admission, cancellation and error handlers through transport
          // closure, including the final response flush and incomplete uploads.
          await Promise.all([requestClosed, responseClosed])
        })
        .finally(() => {
          clearTimeout(timer)
          request.raw.off('aborted', stop)
          request.raw.off('error', stop)
          res.off('close', abort)
          active.delete(task)
        })
      active.set(task, cancel)
      await task
    }
  )
}
