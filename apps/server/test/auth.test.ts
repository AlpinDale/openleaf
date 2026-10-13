import { DEFAULT_USER_SETTINGS } from '@openleaf/shared'
import { describe, expect, it } from 'vitest'
import { projectMembers } from '../src/db/schema.js'
import {
  as,
  cookieFrom,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

describe('auth', async () => {
  const { app } = await createTestApp()

  it('registers and returns the user with default settings', async () => {
    const user = await registerUser(app, 'Ada')
    const res = await as(app, user)({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      user: { id: user.id, email: user.email, name: 'Ada' },
      settings: DEFAULT_USER_SETTINGS,
      learnedWords: [],
    })
  })

  it('normalises email and rejects duplicates with 409', async () => {
    const payload = {
      email: '  Dup@Example.com ',
      name: 'A',
      password: 'password1',
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload,
    })
    expect(first.json().user.email).toBe('dup@example.com')
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...payload, email: 'dup@example.com' },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('conflict')
  })

  it('rejects unauthenticated and wrong-password requests with 401', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode
    ).toBe(401)
    const user = await registerUser(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'wrong password' },
      remoteAddress: '10.0.0.1',
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('logs in, merges settings, and logs out', async () => {
    const user = await registerUser(app)
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'correct horse' },
      remoteAddress: '10.0.0.2',
    })
    expect(login.statusCode).toBe(200)
    const session = { ...user, cookie: cookieFrom(login.headers['set-cookie']) }
    const patch = await as(
      app,
      session
    )({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { settings: { fontSize: 16, keybindings: 'vim' } },
    })
    expect(patch.json().settings).toMatchObject({
      fontSize: 16,
      keybindings: 'vim',
      autoCompile: true,
    })
    const bad = await as(
      app,
      session
    )({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { settings: { fontSize: 99 } },
    })
    expect(bad.statusCode).toBe(400)
    await as(
      app,
      session
    )({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'content-type': 'application/json' },
    })
    expect(
      (await as(app, session)({ method: 'GET', url: '/api/auth/me' }))
        .statusCode
    ).toBe(401)
    // The registration session is unaffected.
    expect(
      (await as(app, user)({ method: 'GET', url: '/api/auth/me' })).statusCode
    ).toBe(200)
  })

  it('changing the password ends other sessions', async () => {
    const user = await registerUser(app)
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'correct horse' },
      remoteAddress: '10.0.0.3',
    })
    const other = { ...user, cookie: cookieFrom(login.headers['set-cookie']) }
    const wrong = await as(
      app,
      user
    )({
      method: 'POST',
      url: '/api/users/me/password',
      payload: { currentPassword: 'nope', newPassword: 'new password' },
    })
    expect(wrong.statusCode).toBe(403)
    const ok = await as(
      app,
      user
    )({
      method: 'POST',
      url: '/api/users/me/password',
      payload: {
        currentPassword: 'correct horse',
        newPassword: 'new password',
      },
    })
    expect(ok.statusCode).toBe(200)
    expect(
      (await as(app, other)({ method: 'GET', url: '/api/auth/me' })).statusCode
    ).toBe(401)
    expect(
      (await as(app, user)({ method: 'GET', url: '/api/auth/me' })).statusCode
    ).toBe(200)
  })

  it('rate limits the 11th login per minute per IP', async () => {
    const user = await registerUser(app)
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'correct horse' },
        remoteAddress: '10.9.9.9',
      })
      codes.push(res.statusCode)
      if (i === 10) expect(res.json().error.code).toBe('rate_limited')
    }
    expect(codes.slice(0, 10).every(c => c === 200)).toBe(true)
    expect(codes[10]).toBe(429)
  })

  it('requires a JSON or multipart content type on API writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    })
    expect(res.statusCode).toBe(400)
  })

  it('manages learned words and git tokens', async () => {
    const user = await registerUser(app)
    const req = as(app, user)
    await req({
      method: 'PUT',
      url: '/api/users/me/learned-words/teh',
      headers: { 'content-type': 'application/json' },
    })
    await req({
      method: 'PUT',
      url: '/api/users/me/learned-words/abc',
      headers: { 'content-type': 'application/json' },
    })
    await req({
      method: 'DELETE',
      url: '/api/users/me/learned-words/abc',
      headers: { 'content-type': 'application/json' },
    })
    expect(
      (await req({ method: 'GET', url: '/api/auth/me' })).json().learnedWords
    ).toEqual(['teh'])

    const created = await req({
      method: 'POST',
      url: '/api/users/me/git-tokens',
      payload: { label: 'laptop' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().token).toMatch(/^olg_[A-Za-z0-9_-]{43}$/)
    const list = await req({ method: 'GET', url: '/api/users/me/git-tokens' })
    expect(list.json().tokens).toHaveLength(1)
    expect(list.json().tokens[0]).not.toHaveProperty('tokenHash')
    const id = list.json().tokens[0].id
    expect(
      (
        await req({
          method: 'DELETE',
          url: `/api/users/me/git-tokens/${id}`,
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode
    ).toBe(200)
    expect(
      (await req({ method: 'GET', url: '/api/users/me/git-tokens' })).json()
        .tokens
    ).toEqual([])
  })
})

describe('project roles', async () => {
  const { app } = await createTestApp()

  it('hides projects from non-members and enforces minimum roles', async () => {
    const owner = await registerUser(app)
    const projectId = await createProject(app, owner)
    const stranger = await registerUser(app)
    const hidden = await as(
      app,
      stranger
    )({ method: 'GET', url: `/api/projects/${projectId}` })
    expect(hidden.statusCode).toBe(404)
    expect(hidden.json().error.code).toBe('not_found')

    const viewer = await registerUser(app)
    app.ctx.db
      .insert(projectMembers)
      .values({
        projectId,
        userId: viewer.id,
        role: 'viewer',
        createdAt: Date.now(),
      })
      .run()
    expect(
      (
        await as(
          app,
          viewer
        )({ method: 'GET', url: `/api/projects/${projectId}` })
      ).statusCode
    ).toBe(200)
    const tree = await getTree(app, viewer, projectId)
    const res = await as(
      app,
      viewer
    )({
      method: 'POST',
      url: `/api/projects/${projectId}/entries`,
      payload: { parentId: tree.rootFolderId, name: 'x.tex', kind: 'doc' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
  })
})

describe('signup disabled', async () => {
  const { app } = await createTestApp({ OPENLEAF_ALLOW_SIGNUP: 'false' })

  it('allows the first user and then returns 403 signup_disabled', async () => {
    await registerUser(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'second@example.com',
        name: 'B',
        password: 'password1',
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('signup_disabled')
  })
})
