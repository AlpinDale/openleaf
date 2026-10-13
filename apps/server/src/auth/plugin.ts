import type { Role } from '@openleaf/shared'
import { roleAtLeast } from '@openleaf/shared'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { projectMembers, projects } from '../db/schema.js'
import { forbidden, HttpError, notFound } from '../errors.js'
import type { RequestUser } from '../types.js'
import { resolveSession, SESSION_COOKIE } from './sessions.js'

export function setSessionCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  token: string,
  expiresAt: number
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: app.ctx.config.secureCookies,
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: app.ctx.config.secureCookies,
  })
}

/** Resolves `request.user` from the session cookie on every request. */
export function installAuth(app: FastifyInstance) {
  app.decorateRequest('user', null)
  app.decorateRequest('sessionId', null)
  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return
    const session = resolveSession(app.ctx.db, token)
    if (!session) return
    request.user = session.user
    request.sessionId = session.sessionId
    if (session.extendedTo)
      setSessionCookie(app, reply, token, session.extendedTo)
  })
}

export async function requireUser(request: FastifyRequest) {
  userOf(request)
}

/** The logged-in user; throws 401 when there is none. */
export function userOf(request: FastifyRequest): RequestUser {
  if (!request.user) throw new HttpError(401, 'unauthorized', 'Not logged in')
  return request.user
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function getMembership(
  app: FastifyInstance,
  projectId: string,
  userId: string
) {
  return app.ctx.db
    .select({ project: projects, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      )
    )
    .get()
}

/** Pre-handler: loads `:id` membership; 404 for non-members, 403 when the role is too low. */
export function requireProjectRole(min: Role) {
  return async function (this: FastifyInstance, request: FastifyRequest) {
    await requireUser(request)
    const { id } = request.params as { id?: string }
    if (!isUuid(id)) throw notFound('Project not found')
    const row = getMembership(this, id, userOf(request).id)
    if (!row) throw notFound('Project not found')
    request.project = row.project
    request.role = row.role
    if (!roleAtLeast(row.role, min)) throw forbidden('Insufficient permissions')
  }
}
