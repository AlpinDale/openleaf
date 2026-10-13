import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider'
import {
  FORCED_CLOSE_REASONS,
  MAX_REALTIME_UPDATE_BYTES,
  projectDocumentName,
  YDOC_TEXTS,
} from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { sha256Hex } from '../src/auth/tokens.js'
import { projectMembers, projectYdocs, sessions } from '../src/db/schema.js'
import {
  as,
  cookieFrom,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

describe('realtime', async () => {
  const { app } = await createTestApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  const url = `ws://127.0.0.1:${address.port}/collab`

  const owner = await registerUser(app)
  const projectId = await createProject(app, owner)
  const tree = await getTree(app, owner, projectId)
  const mainId = tree.entries.find(e => e.name === 'main.tex')?.id as string

  const providers: HocuspocusProvider[] = []
  afterAll(() => {
    for (const p of providers) {
      p.destroy()
      p.configuration.websocketProvider.destroy()
    }
  })

  function connect(cookie: string, id = projectId) {
    class CookieWebSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie } })
      }
    }
    const websocketProvider = new HocuspocusProviderWebsocket({
      url,
      WebSocketPolyfill:
        CookieWebSocket as unknown as typeof globalThis.WebSocket,
    })
    let onSynced!: () => void
    let onAuthFailed!: (reason: string) => void
    const synced = new Promise<void>(resolve => {
      onSynced = resolve
    })
    const authFailed = new Promise<string>(resolve => {
      onAuthFailed = resolve
    })
    let onClosed!: (reason: string) => void
    const closed = new Promise<string>(resolve => {
      onClosed = resolve
    })
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: projectDocumentName(id),
      token: 'cookie',
      onSynced: () => onSynced(),
      onAuthenticationFailed: ({ reason }) => onAuthFailed(reason),
      onClose: ({ event }) => onClosed(event.reason),
    })
    // A shared websocketProvider doesn't auto-attach its providers.
    provider.attach()
    providers.push(provider)
    return { provider, synced, authFailed, closed }
  }

  const storedText = () => {
    const row = app.ctx.db
      .select()
      .from(projectYdocs)
      .where(eq(projectYdocs.projectId, projectId))
      .get()
    const doc = new Y.Doc()
    if (row) Y.applyUpdate(doc, new Uint8Array(row.state))
    return doc.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.toString()
  }

  it.each(['http://evil.example', 'http://127.0.0.1:3001', 'null'])(
    'rejects websocket upgrades from an untrusted Origin: %s',
    async origin => {
      const response = await app.inject({
        method: 'GET',
        url: '/collab',
        headers: { cookie: owner.cookie, origin },
      })
      expect(response.statusCode).toBe(403)
    }
  )

  it('accepts a websocket upgrade from the configured public origin', async () => {
    const socket = new WebSocket(url, {
      headers: {
        cookie: owner.cookie,
        origin: new URL(app.ctx.config.publicUrl).origin,
      },
    })
    const opened = Promise.withResolvers<void>()
    socket.once('open', opened.resolve)
    socket.once('error', opened.reject)
    await opened.promise
    const closed = Promise.withResolvers<void>()
    socket.once('close', () => closed.resolve())
    socket.close()
    await closed.promise
  })

  it('revokes an already-connected websocket on logout', async () => {
    const user = await registerUser(app)
    const id = await createProject(app, user)
    const connection = connect(user.cookie, id)
    await connection.synced
    const response = await as(
      app,
      user
    )({
      method: 'POST',
      url: '/api/auth/logout',
      payload: {},
    })
    expect(response.statusCode).toBe(200)
    expect(await connection.closed).toBe('Not logged in')
    connection.provider.destroy()
  })

  it('revokes other connected sessions after a password change', async () => {
    const user = await registerUser(app)
    const id = await createProject(app, user)
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'correct horse' },
      remoteAddress: '10.4.0.1',
    })
    const connection = connect(cookieFrom(login.headers['set-cookie']), id)
    await connection.synced
    const response = await as(
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
    expect(response.statusCode).toBe(200)
    expect(await connection.closed).toBe('Not logged in')
    connection.provider.destroy()
  })

  it('disconnects an idle socket whose session has expired', async () => {
    const user = await registerUser(app)
    const id = await createProject(app, user)
    const connection = connect(user.cookie, id)
    await connection.synced
    const token = user.cookie.slice(user.cookie.indexOf('=') + 1)
    app.ctx.db
      .update(sessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(sessions.id, sha256Hex(token)))
      .run()
    app.ctx.realtime.disconnectRevokedSessions()
    expect(await connection.closed).toBe('Not logged in')
    connection.provider.destroy()
  })

  it('syncs member edits and persists them after the debounce', async () => {
    const conn = connect(owner.cookie)
    await conn.synced
    const ytext = conn.provider.document
      .getMap<Y.Text>(YDOC_TEXTS)
      .get(mainId) as Y.Text
    expect(ytext.toString()).toContain('\\documentclass')
    ytext.insert(0, '% hello from a test\n')
    await new Promise(r => setTimeout(r, 3000))
    expect(storedText()).toMatch(/^% hello from a test\n\\documentclass/)
  }, 15000)

  it('rejects non-members', async () => {
    const stranger = await registerUser(app)
    const conn = connect(stranger.cookie)
    expect(await conn.authFailed).toBeTruthy()
  })

  it('does not apply edits from viewers', async () => {
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
    const conn = connect(viewer.cookie)
    await conn.synced
    const ytext = conn.provider.document
      .getMap<Y.Text>(YDOC_TEXTS)
      .get(mainId) as Y.Text
    ytext.insert(0, 'VIEWER EDIT ')
    await new Promise(r => setTimeout(r, 500))
    const serverText = await app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.toString()
    )
    expect(serverText).not.toContain('VIEWER EDIT')
  })

  it('closes the document for good when an update is too large', async () => {
    const conn = connect(owner.cookie)
    await conn.synced
    const ytext = conn.provider.document
      .getMap<Y.Text>(YDOC_TEXTS)
      .get(mainId) as Y.Text
    ytext.insert(0, 'x'.repeat(MAX_REALTIME_UPDATE_BYTES + 1))
    expect(await conn.closed).toBe(FORCED_CLOSE_REASONS.updateTooLarge)
    const serverLength = await app.ctx.realtime.withProjectDoc(
      projectId,
      doc => doc.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.length ?? 0
    )
    expect(serverLength).toBeLessThan(MAX_REALTIME_UPDATE_BYTES)
  }, 15000)

  it('closes clients of a deleted project', async () => {
    const doomed = await createProject(app, owner)
    const conn = connect(owner.cookie, doomed)
    await conn.synced
    const req = as(app, owner)
    await req({
      method: 'POST',
      url: `/api/projects/${doomed}/trash`,
      payload: {},
    })
    const res = await req({
      method: 'DELETE',
      url: `/api/projects/${doomed}`,
      payload: {},
    })
    expect(res.statusCode).toBeLessThan(300)
    expect(await conn.closed).toBe(FORCED_CLOSE_REASONS.projectDeleted)
  })

  it('drains an accepted websocket update before the shutdown store flush', async () => {
    const connection = connect(owner.cookie)
    await connection.synced
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const marker = '% accepted-before-shutdown\n'
    const extension = {
      async beforeHandleMessage({ update }: { update: Uint8Array }) {
        if (!Buffer.from(update).includes(Buffer.from(marker))) return
        entered.resolve()
        await release.promise
      },
    }
    const extensions = app.ctx.realtime.hocuspocus.configuration.extensions
    extensions.push(extension)
    try {
      connection.provider.document
        .getMap<Y.Text>(YDOC_TEXTS)
        .get(mainId)
        ?.insert(0, marker)
      await entered.promise
      app.ctx.realtime.beginShutdown()
      const flushed = app.ctx.realtime.flushAll()
      release.resolve()
      await flushed
      expect(storedText()).toContain(marker)
    } finally {
      release.resolve()
      extensions.splice(extensions.indexOf(extension), 1)
      connection.provider.destroy()
    }
  })
})
