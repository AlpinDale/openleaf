import { and, eq, gt, lte, ne } from 'drizzle-orm'
import type { Db } from '../db/index.js'
import { sessions, users } from '../db/schema.js'
import type { RequestUser } from '../types.js'
import { randomToken, sha256Hex } from './tokens.js'

export const SESSION_COOKIE = 'openleaf_session'
const DAY = 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 30 * DAY
const EXTEND_BELOW_MS = 29 * DAY

export function createSession(db: Db, userId: string) {
  const token = randomToken()
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS
  db.delete(sessions).where(lte(sessions.expiresAt, now)).run()
  db.insert(sessions)
    .values({ id: sha256Hex(token), userId, createdAt: now, expiresAt })
    .run()
  return { token, expiresAt }
}

export type ResolvedSession = {
  sessionId: string
  user: RequestUser
  /** New expiry when the session was extended during this lookup. */
  extendedTo: number | null
}

export function resolveSession(db: Db, token: string): ResolvedSession | null {
  const now = Date.now()
  const id = sha256Hex(token)
  const row = db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .get()
  if (!row) return null
  let extendedTo: number | null = null
  if (row.expiresAt - now < EXTEND_BELOW_MS) {
    extendedTo = now + SESSION_TTL_MS
    db.update(sessions)
      .set({ expiresAt: extendedTo })
      .where(eq(sessions.id, id))
      .run()
  }
  return {
    sessionId: id,
    user: { id: row.id, email: row.email, name: row.name },
    extendedTo,
  }
}

export function deleteSession(db: Db, sessionId: string) {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run()
}

export function deleteOtherSessions(
  db: Db,
  userId: string,
  keepSessionId: string
) {
  db.delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .run()
}

/** Parses a raw Cookie header and returns the session token, if any. */
export function sessionTokenFromCookieHeader(
  header: string | undefined
): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    if (part.slice(0, eqIdx).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(eqIdx + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}
