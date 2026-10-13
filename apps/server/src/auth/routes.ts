import {
  ChangePasswordBody,
  CreateGitTokenBody,
  LearnedWord,
  LoginBody,
  parseUserSettings,
  RegisterBody,
  UpdateMeBody,
} from '@openleaf/shared'
import { and, asc, count, eq, gt } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { gitTokens, learnedWords, sessions, users } from '../db/schema.js'
import { conflict, HttpError, notFound, parse } from '../errors.js'
import { hashPassword, verifyPassword } from './passwords.js'
import {
  clearSessionCookie,
  requireUser,
  setSessionCookie,
  userOf,
} from './plugin.js'
import {
  createSession,
  deleteOtherSessions,
  deleteSession,
} from './sessions.js'
import { randomToken, sha256Hex } from './tokens.js'

function userRow(app: FastifyInstance, request: FastifyRequest) {
  const row = app.ctx.db
    .select()
    .from(users)
    .where(eq(users.id, userOf(request).id))
    .get()
  if (!row) throw new HttpError(401, 'unauthorized', 'Not logged in')
  return row
}

function settingsOf(json: string) {
  try {
    return parseUserSettings(JSON.parse(json))
  } catch {
    return parseUserSettings({})
  }
}

function learnedWordsOf(app: FastifyInstance, userId: string) {
  return app.ctx.db
    .select({ word: learnedWords.word })
    .from(learnedWords)
    .where(eq(learnedWords.userId, userId))
    .orderBy(asc(learnedWords.word))
    .all()
    .map(r => r.word)
}

export async function authRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx
  // Unknown accounts still pay the same Argon2 verification cost.
  const unknownAccountHash = await hashPassword(randomToken())

  app.post(
    '/auth/register',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = parse(RegisterBody, request.body)
      if (!config.allowSignup) {
        const existing = db.select({ n: count() }).from(users).get()?.n ?? 0
        if (existing > 0) {
          throw new HttpError(
            403,
            'signup_disabled',
            'Sign-up is disabled on this server'
          )
        }
      }
      if (
        db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, body.email))
          .get()
      ) {
        throw conflict('An account with this email already exists')
      }
      const id = crypto.randomUUID()
      const passwordHash = await hashPassword(body.password)
      let session: { token: string; expiresAt: number }
      try {
        // Hashing yields. Serialize the bootstrap check, user and session inserts
        // so only one first account bypasses disabled signup, even across SQLite
        // connections, and a failed session write cannot leave half a signup.
        session = db.transaction(
          () => {
            if (
              !config.allowSignup &&
              (db.select({ n: count() }).from(users).get()?.n ?? 0) > 0
            ) {
              throw new HttpError(
                403,
                'signup_disabled',
                'Sign-up is disabled on this server'
              )
            }
            db.insert(users)
              .values({
                id,
                email: body.email,
                name: body.name,
                passwordHash,
                createdAt: Date.now(),
              })
              .run()
            return createSession(db, id)
          },
          { behavior: 'immediate' }
        )
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw conflict('An account with this email already exists')
        }
        throw err
      }
      setSessionCookie(app, reply, session.token, session.expiresAt)
      return reply
        .status(201)
        .send({ user: { id, email: body.email, name: body.name } })
    }
  )

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parse(LoginBody, request.body)
      const row = db
        .select()
        .from(users)
        .where(eq(users.email, body.email))
        .get()
      const verified = await verifyPassword(
        row?.passwordHash ?? unknownAccountHash,
        body.password
      )
      if (!row || !verified) {
        throw new HttpError(401, 'unauthorized', 'Incorrect email or password')
      }
      // A password change may have completed while Argon2 was verifying.
      const current = db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, row.id))
        .get()
      if (current?.passwordHash !== row.passwordHash) {
        throw new HttpError(401, 'unauthorized', 'Incorrect email or password')
      }
      const session = createSession(db, row.id)
      setSessionCookie(app, reply, session.token, session.expiresAt)
      return { user: { id: row.id, email: row.email, name: row.name } }
    }
  )

  app.post(
    '/auth/logout',
    { preHandler: requireUser },
    async (request, reply) => {
      if (request.sessionId) deleteSession(db, request.sessionId)
      app.ctx.realtime.disconnectRevokedSessions()
      clearSessionCookie(app, reply)
      return { ok: true }
    }
  )

  app.get('/auth/me', { preHandler: requireUser }, async request => {
    const row = userRow(app, request)
    return {
      user: { id: row.id, email: row.email, name: row.name },
      settings: settingsOf(row.settingsJson),
      learnedWords: learnedWordsOf(app, row.id),
    }
  })

  app.patch('/users/me', { preHandler: requireUser }, async request => {
    const body = parse(UpdateMeBody, request.body)
    const row = userRow(app, request)
    const settings = body.settings
      ? parseUserSettings({ ...settingsOf(row.settingsJson), ...body.settings })
      : settingsOf(row.settingsJson)
    const name = body.name ?? row.name
    db.update(users)
      .set({ name, settingsJson: JSON.stringify(settings) })
      .where(eq(users.id, row.id))
      .run()
    return { user: { id: row.id, email: row.email, name }, settings }
  })

  app.post(
    '/users/me/password',
    {
      preHandler: requireUser,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: request => request.user?.id ?? request.ip,
        },
      },
    },
    async request => {
      const body = parse(ChangePasswordBody, request.body)
      const row = userRow(app, request)
      if (!(await verifyPassword(row.passwordHash, body.currentPassword))) {
        throw new HttpError(403, 'forbidden', 'Current password is incorrect')
      }
      const passwordHash = await hashPassword(body.newPassword)
      // Do not let concurrent changes overwrite a newer password or a revoked
      // session finish a password change after its expensive hash has returned.
      if (
        !request.sessionId ||
        !db
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.id, request.sessionId),
              gt(sessions.expiresAt, Date.now())
            )
          )
          .get()
      ) {
        throw new HttpError(401, 'unauthorized', 'Not logged in')
      }
      const updated = db
        .update(users)
        .set({ passwordHash })
        .where(
          and(eq(users.id, row.id), eq(users.passwordHash, row.passwordHash))
        )
        .run()
      if (!updated.changes) throw conflict('The password has already changed')
      deleteOtherSessions(db, row.id, request.sessionId)
      app.ctx.realtime.disconnectRevokedSessions()
      return { ok: true }
    }
  )

  app.put<{ Params: { word: string } }>(
    '/users/me/learned-words/:word',
    { preHandler: requireUser },
    async request => {
      const word = parse(LearnedWord, request.params.word)
      db.insert(learnedWords)
        .values({ userId: userOf(request).id, word })
        .onConflictDoNothing()
        .run()
      return { learnedWords: learnedWordsOf(app, userOf(request).id) }
    }
  )

  app.delete<{ Params: { word: string } }>(
    '/users/me/learned-words/:word',
    { preHandler: requireUser },
    async request => {
      const word = parse(LearnedWord, request.params.word)
      db.delete(learnedWords)
        .where(
          and(
            eq(learnedWords.userId, userOf(request).id),
            eq(learnedWords.word, word)
          )
        )
        .run()
      return { learnedWords: learnedWordsOf(app, userOf(request).id) }
    }
  )

  const tokenColumns = {
    id: gitTokens.id,
    label: gitTokens.label,
    createdAt: gitTokens.createdAt,
    lastUsedAt: gitTokens.lastUsedAt,
  }

  app.get(
    '/users/me/git-tokens',
    { preHandler: requireUser },
    async request => {
      return {
        tokens: db
          .select(tokenColumns)
          .from(gitTokens)
          .where(eq(gitTokens.userId, userOf(request).id))
          .orderBy(asc(gitTokens.createdAt))
          .all(),
      }
    }
  )

  app.post(
    '/users/me/git-tokens',
    { preHandler: requireUser },
    async (request, reply) => {
      const body = parse(CreateGitTokenBody, request.body)
      const token = `olg_${randomToken()}`
      const row = {
        id: crypto.randomUUID(),
        userId: userOf(request).id,
        label: body.label,
        tokenHash: sha256Hex(token),
        createdAt: Date.now(),
        lastUsedAt: null,
      }
      db.insert(gitTokens).values(row).run()
      return reply.status(201).send({
        token,
        info: {
          id: row.id,
          label: row.label,
          createdAt: row.createdAt,
          lastUsedAt: null,
        },
      })
    }
  )

  app.delete<{ Params: { tokenId: string } }>(
    '/users/me/git-tokens/:tokenId',
    { preHandler: requireUser },
    async request => {
      const result = db
        .delete(gitTokens)
        .where(
          and(
            eq(gitTokens.id, request.params.tokenId),
            eq(gitTokens.userId, userOf(request).id)
          )
        )
        .run()
      if (result.changes === 0) throw notFound('Token not found')
      return { ok: true }
    }
  )
}
