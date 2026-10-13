import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as passwords from '../src/auth/passwords.js'
import { createSession } from '../src/auth/sessions.js'
import { sha256Hex } from '../src/auth/tokens.js'
import { sessions } from '../src/db/schema.js'
import { as, createTestApp, registerUser } from './helpers.js'

afterEach(() => vi.restoreAllMocks())

describe('authentication security', async () => {
  const { app } = await createTestApp()

  it('limits registration before doing expensive hashing', async () => {
    for (let i = 0; i < 31; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {},
        remoteAddress: '10.3.0.1',
      })
      expect(response.statusCode).toBe(i === 30 ? 429 : 400)
    }
  })

  it('limits password guesses by account even when source IP changes', async () => {
    const user = await registerUser(app)
    for (let i = 0; i < 11; i++) {
      const response = await as(
        app,
        user
      )({
        method: 'POST',
        url: '/api/users/me/password',
        payload: { currentPassword: 'incorrect', newPassword: 'new password' },
        remoteAddress: `10.3.1.${i + 1}`,
      })
      expect(response.statusCode).toBe(i === 10 ? 429 : 403)
    }
  })

  it('does not let two concurrent password changes overwrite each other', async () => {
    const user = await registerUser(app)
    const original = passwords.hashPassword
    const gate = Promise.withResolvers<void>()
    const bothStarted = Promise.withResolvers<void>()
    let calls = 0
    vi.spyOn(passwords, 'hashPassword').mockImplementation(async password => {
      if (++calls === 2) bothStarted.resolve()
      await gate.promise
      return original(password)
    })
    const change = (newPassword: string) =>
      as(
        app,
        user
      )({
        method: 'POST',
        url: '/api/users/me/password',
        payload: { currentPassword: 'correct horse', newPassword },
      })
    const first = change('first new password')
    const second = change('second new password')
    await bothStarted.promise
    gate.resolve()
    const results = await Promise.all([first, second])
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409])
    const winner =
      results[0].statusCode === 200
        ? 'first new password'
        : 'second new password'
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: winner },
      remoteAddress: '10.3.2.1',
    })
    expect(login.statusCode).toBe(200)
  })

  it('rejects an old-password login if the password changes during verification', async () => {
    const user = await registerUser(app)
    const original = passwords.verifyPassword
    const verified = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    let first = true
    vi.spyOn(passwords, 'verifyPassword').mockImplementation(
      async (hash, password) => {
        const blocked = first
        first = false
        const result = await original(hash, password)
        if (blocked) {
          verified.resolve()
          await gate.promise
        }
        return result
      }
    )
    const login = app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'correct horse' },
      remoteAddress: '10.3.2.2',
    })
    await verified.promise
    try {
      const changed = await as(
        app,
        user
      )({
        method: 'POST',
        url: '/api/users/me/password',
        payload: {
          currentPassword: 'correct horse',
          newPassword: 'replacement password',
        },
      })
      expect(changed.statusCode).toBe(200)
    } finally {
      gate.resolve()
    }
    const response = await login
    expect(response.statusCode).toBe(401)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('prunes expired sessions when creating a new one', async () => {
    const user = await registerUser(app)
    const expired = createSession(app.ctx.db, user.id)
    const id = sha256Hex(expired.token)
    app.ctx.db
      .update(sessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(sessions.id, id))
      .run()
    createSession(app.ctx.db, user.id)
    expect(
      app.ctx.db.select().from(sessions).where(eq(sessions.id, id)).get()
    ).toBeUndefined()
  })
})

describe('disabled sign-up concurrency', async () => {
  const { app } = await createTestApp({ OPENLEAF_ALLOW_SIGNUP: 'false' })

  it('allows exactly one bootstrap account during simultaneous registration', async () => {
    const original = passwords.hashPassword
    const gate = Promise.withResolvers<void>()
    const bothStarted = Promise.withResolvers<void>()
    let calls = 0
    vi.spyOn(passwords, 'hashPassword').mockImplementation(async password => {
      if (++calls === 2) bothStarted.resolve()
      await gate.promise
      return original(password)
    })
    const register = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, name: 'Bootstrap', password: 'correct horse' },
      })
    const first = register('first@example.com')
    const second = register('second@example.com')
    await bothStarted.promise
    gate.resolve()
    const results = await Promise.all([first, second])
    expect(results.map(r => r.statusCode).sort()).toEqual([201, 403])
    expect(results.find(r => r.statusCode === 403)?.json().error.code).toBe(
      'signup_disabled'
    )
  })
})
