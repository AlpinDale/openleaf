import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider'
import { OutgoingMessage } from '@hocuspocus/server'
import {
  encodeAnchor,
  FORCED_CLOSE_REASONS,
  projectDocumentName,
  YDOC_CHANGES,
  YDOC_COMMENTS,
  YDOC_TEXTS,
  YDOC_TRACK_CHANGES,
} from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { projectMembers, projectYdocs } from '../src/db/schema.js'
import {
  assertProjectStateWithinLimit,
  ProjectAdmission,
} from '../src/realtime/admission.js'
import { projectLock } from '../src/tree/locks.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

describe('realtime admission', async () => {
  const { app } = await createTestApp({
    OPENLEAF_MAX_PROJECT_STATE_MB: String(4096 / (1024 * 1024)),
    OPENLEAF_MAX_REALTIME_CONNECTIONS_PER_USER: '4',
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string')
    throw new Error('No test address')
  const url = `ws://127.0.0.1:${address.port}/collab`
  const providers: HocuspocusProvider[] = []
  const transports: HocuspocusProviderWebsocket[] = []
  afterEach(() => {
    for (const provider of providers) provider.destroy()
    for (const transport of transports) transport.destroy()
    providers.length = 0
    transports.length = 0
  })

  async function fixture(role: 'owner' | 'reviewer' = 'owner') {
    const owner = await registerUser(app)
    const projectId = await createProject(app, owner)
    const user = role === 'owner' ? owner : await registerUser(app)
    if (role !== 'owner')
      app.ctx.db
        .insert(projectMembers)
        .values({
          projectId,
          userId: user.id,
          role,
          createdAt: Date.now(),
        })
        .run()
    const tree = await getTree(app, owner, projectId)
    const docId = tree.entries.find(e => e.name === 'main.tex')?.id as string
    let socket!: WebSocket
    class CookieWebSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie: user.cookie } })
        socket = this
      }
    }
    const synced = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<string>()
    const transport = new HocuspocusProviderWebsocket({
      url,
      WebSocketPolyfill:
        CookieWebSocket as unknown as typeof globalThis.WebSocket,
    })
    const provider = new HocuspocusProvider({
      websocketProvider: transport,
      name: projectDocumentName(projectId),
      token: 'cookie',
      onSynced: () => synced.resolve(),
      onAuthenticationFailed: ({ reason }) => synced.reject(new Error(reason)),
      onClose: ({ event }) => closed.resolve(event.reason),
    })
    transports.push(transport)
    providers.push(provider)
    provider.attach()
    await synced.promise
    const ytext = provider.document
      .getMap<Y.Text>(YDOC_TEXTS)
      .get(docId) as Y.Text
    return {
      owner,
      user,
      projectId,
      docId,
      provider,
      ytext,
      socket,
      closed: closed.promise,
    }
  }

  async function acknowledged(provider: HocuspocusProvider, fn: () => void) {
    const done = Promise.withResolvers<void>()
    const listener = ({ number }: { number: number }) => {
      if (number === 0) done.resolve()
    }
    const closed = ({ event }: { event: { reason: string } }) =>
      done.reject(new Error(event.reason))
    provider.on('unsyncedChanges', listener)
    provider.on('close', closed)
    try {
      fn()
      if (!provider.hasUnsyncedChanges) done.resolve()
      await done.promise
    } finally {
      provider.off('unsyncedChanges', listener)
      provider.off('close', closed)
    }
  }

  it('rejects cumulative growth from repeated individually-small updates before live/persisted state exceeds its limit', async () => {
    const f = await fixture()
    for (let i = 0; i < 20; i++) {
      try {
        await acknowledged(f.provider, () =>
          f.ytext.insert(0, String(i).padStart(2, '0') + 'x'.repeat(254))
        )
      } catch {
        break
      }
    }
    expect(await f.closed).toBe(FORCED_CLOSE_REASONS.stateTooLarge)
    const state = await app.ctx.realtime.withProjectDoc(f.projectId, doc =>
      Y.encodeStateAsUpdate(doc)
    )
    expect(state.byteLength).toBeLessThanOrEqual(
      app.ctx.config.maxProjectStateBytes
    )
    await app.ctx.realtime.flushAll()
    const stored = app.ctx.db
      .select()
      .from(projectYdocs)
      .where(eq(projectYdocs.projectId, f.projectId))
      .get()
    expect(stored?.state.byteLength).toBeLessThanOrEqual(
      app.ctx.config.maxProjectStateBytes
    )
    expect(
      (await as(app, f.owner)({ method: 'GET', url: '/api/auth/me' }))
        .statusCode
    ).toBe(200)
  })

  it.each(['unknown-root', 'unknown-document'])(
    'rejects malformed state without changing the live document: %s',
    async kind => {
      const f = await fixture()
      const invalidId = crypto.randomUUID()
      if (kind === 'unknown-root')
        f.provider.document.getMap('unknown').set('payload', 'untrusted')
      else
        f.provider.document
          .getMap(YDOC_TEXTS)
          .set(invalidId, new Y.Text('untrusted'))
      expect(await f.closed).toBe(FORCED_CLOSE_REASONS.invalidUpdate)
      const valid = await app.ctx.realtime.withProjectDoc(
        f.projectId,
        doc =>
          !doc.share.has('unknown') && !doc.getMap(YDOC_TEXTS).has(invalidId)
      )
      expect(valid).toBe(true)
    }
  )

  it('rejects raw untracked text changes from a reviewer', async () => {
    const f = await fixture('reviewer')
    const original = f.ytext.toString()
    f.ytext.insert(0, 'UNTRACKED REVIEWER EDIT')
    expect(await f.closed).toBe(FORCED_CLOSE_REASONS.invalidUpdate)
    const text = await app.ctx.realtime.withProjectDoc(f.projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(f.docId)?.toString()
    )
    expect(text).toBe(original)
  })

  it('enforces a live owner-to-reviewer downgrade before accepting the next edit', async () => {
    const f = await fixture()
    const original = f.ytext.toString()
    app.ctx.db
      .update(projectMembers)
      .set({ role: 'reviewer' })
      .where(eq(projectMembers.userId, f.user.id))
      .run()
    f.ytext.insert(0, 'AFTER DOWNGRADE UNTRACKED')
    expect(await f.closed).toBe(FORCED_CLOSE_REASONS.invalidUpdate)
    const text = await app.ctx.realtime.withProjectDoc(f.projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(f.docId)?.toString()
    )
    expect(text).toBe(original)
  })

  it('accepts atomic reviewer tracked insert/backspace/delete/undo transactions', async () => {
    const f = await fixture('reviewer')
    const doc = f.provider.document
    const changes = doc.getMap<Y.Map<unknown>>(YDOC_CHANGES)
    const undo = new Y.UndoManager([f.ytext, changes])
    const id = crypto.randomUUID()
    const original = f.ytext.toString()
    const position = original.length
    try {
      await acknowledged(f.provider, () =>
        doc.transact(() => {
          f.ytext.insert(position, 'abc')
          changes.set(
            id,
            new Y.Map<unknown>([
              ['docId', f.docId],
              ['type', 'insert'],
              ['userId', f.user.id],
              ['ts', Date.now()],
              ['start', encodeAnchor(f.ytext, position, 0)],
              ['end', encodeAnchor(f.ytext, position + 3, -1)],
            ])
          )
        })
      )
      await acknowledged(f.provider, () =>
        doc.transact(() => {
          f.ytext.delete(position + 2, 1)
          changes.get(id)?.set('end', encodeAnchor(f.ytext, position + 2, -1))
        })
      )
      undo.stopCapturing()
      const deleted = f.ytext.toString().slice(0, 3)
      const deleteId = crypto.randomUUID()
      await acknowledged(f.provider, () =>
        doc.transact(() => {
          f.ytext.delete(0, 3)
          changes.set(
            deleteId,
            new Y.Map<unknown>([
              ['docId', f.docId],
              ['type', 'delete'],
              ['userId', f.user.id],
              ['ts', Date.now()],
              ['pos', encodeAnchor(f.ytext, 0, 0)],
              ['text', deleted],
            ])
          )
        })
      )
      await acknowledged(f.provider, () => undo.undo())
      const result = await app.ctx.realtime.withProjectDoc(
        f.projectId,
        live => ({
          text: live.getMap<Y.Text>(YDOC_TEXTS).get(f.docId)?.toString(),
          author: live
            .getMap<Y.Map<unknown>>(YDOC_CHANGES)
            .get(id)
            ?.get('userId'),
          hasDelete: live.getMap(YDOC_CHANGES).has(deleteId),
        })
      )
      expect(result).toEqual({
        text: `${original}ab`,
        author: f.user.id,
        hasDelete: false,
      })
    } finally {
      undo.destroy()
    }
  })

  it.each(['everyone-tracking', 'forged-author', 'foreign-comment'])(
    'rejects reviewer ownership violations: %s',
    async kind => {
      const f = await fixture('reviewer')
      const doc = f.provider.document
      if (kind === 'everyone-tracking')
        doc.getMap(YDOC_TRACK_CHANGES).set('__all__', true)
      else if (kind === 'forged-author')
        doc.getMap(YDOC_CHANGES).set(
          crypto.randomUUID(),
          new Y.Map<unknown>([
            ['docId', f.docId],
            ['type', 'insert'],
            ['userId', f.owner.id],
            ['ts', Date.now()],
            ['start', encodeAnchor(f.ytext, 0, 0)],
            ['end', encodeAnchor(f.ytext, 1, -1)],
          ])
        )
      else
        doc.getMap(YDOC_COMMENTS).set(
          crypto.randomUUID(),
          new Y.Map<unknown>([
            ['docId', f.docId],
            ['userId', f.owner.id],
            ['start', encodeAnchor(f.ytext, 0, 0)],
            ['end', encodeAnchor(f.ytext, 1, -1)],
          ])
        )
      expect(await f.closed).toBe(FORCED_CLOSE_REASONS.invalidUpdate)
    }
  )

  it.each([
    [10, FORCED_CLOSE_REASONS.stateTooLarge],
    [65, FORCED_CLOSE_REASONS.updateTooLarge],
  ])(
    'rejects %i forged awareness identities before they become active',
    async (count, reason) => {
      const f = await fixture()
      const awareness = f.provider.awareness
      if (!awareness) throw new Error('No awareness')
      const ids = Array.from({ length: count }, (_, i) => 900_000 + i)
      for (const id of ids) {
        awareness.getStates().set(id, { name: 'claimed identity' })
        awareness.meta.set(id, { clock: 1, lastUpdated: Date.now() })
      }
      f.socket.send(
        new OutgoingMessage(f.provider.effectiveName)
          .createAwarenessUpdateMessage(awareness, ids)
          .toUint8Array()
      )
      expect(await f.closed).toBe(reason)
      const document = app.ctx.realtime.hocuspocus.documents.get(
        projectDocumentName(f.projectId)
      )
      expect(document?.awareness.getStates().size ?? 0).toBeLessThanOrEqual(9)
    }
  )
  it('bounds raw queued frames while project mutation is blocked', async () => {
    const f = await fixture()
    const release = await projectLock(f.projectId).acquire()
    try {
      for (let i = 0; i < 100; i++) f.ytext.insert(0, 'x'.repeat(128))
      expect(await f.closed).toBe(FORCED_CLOSE_REASONS.rateLimited)
      expect(
        (await as(app, f.owner)({ method: 'GET', url: '/api/auth/me' }))
          .statusCode
      ).toBe(200)
    } finally {
      release()
    }
    await app.ctx.realtime.flushAll()
    const state = await app.ctx.realtime.withProjectDoc(f.projectId, live =>
      Y.encodeStateAsUpdate(live)
    )
    expect(state.byteLength).toBeLessThanOrEqual(
      app.ctx.config.maxProjectStateBytes
    )
  })

  it('bounds unresolved out-of-order structures before their missing dependencies arrive', async () => {
    const f = await fixture()
    const baseline = Y.encodeStateAsUpdate(f.provider.document)
    const live = new Y.Doc()
    Y.applyUpdate(live, baseline)
    const admission = new ProjectAdmission(
      live,
      app.ctx.db,
      f.projectId,
      app.ctx.config.maxProjectStateBytes
    )
    let rejected = false
    try {
      for (let i = 0; i < 100; i++) {
        const remote = new Y.Doc()
        try {
          Y.applyUpdate(remote, baseline)
          const updates: Uint8Array[] = []
          remote.on('update', update => updates.push(update))
          const text = remote.getMap<Y.Text>(YDOC_TEXTS).get(f.docId) as Y.Text
          text.insert(0, 'missing dependency')
          text.insert(0, 'pending')
          const update = updates[1] as Uint8Array
          expect(update.byteLength).toBeLessThan(256)
          try {
            admission.admit(update, { userId: f.user.id, role: 'owner' })
            Y.applyUpdate(live, update)
          } catch (error) {
            expect(error).toMatchObject({ statusCode: 413 })
            rejected = true
            break
          }
        } finally {
          remote.destroy()
        }
      }
      expect(rejected).toBe(true)
      expect(live.store.pendingStructs).not.toBeNull()
      expect(
        assertProjectStateWithinLimit(live, app.ctx.config.maxProjectStateBytes)
          .byteLength
      ).toBeLessThanOrEqual(app.ctx.config.maxProjectStateBytes)
    } finally {
      admission.destroy()
      live.destroy()
    }
  })

  it('accepts reviewer-owned comment anchors before the HTTP thread exists', async () => {
    const f = await fixture('reviewer')
    const id = crypto.randomUUID()
    await acknowledged(f.provider, () =>
      f.provider.document.getMap(YDOC_COMMENTS).set(
        id,
        new Y.Map<unknown>([
          ['docId', f.docId],
          ['userId', f.user.id],
          ['start', encodeAnchor(f.ytext, 0, 0)],
          ['end', encodeAnchor(f.ytext, 1, -1)],
        ])
      )
    )
    const response = await as(
      app,
      f.user
    )({
      method: 'POST',
      url: `/api/projects/${f.projectId}/threads`,
      payload: { id, docId: f.docId, content: 'Owned anchor' },
    })
    expect(response.statusCode).toBe(201)
    const owner = await app.ctx.realtime.withProjectDoc(f.projectId, live =>
      live.getMap<Y.Map<unknown>>(YDOC_COMMENTS).get(id)?.get('userId')
    )
    expect(owner).toBe(f.user.id)
  })

  it.each(['malformed-anchor', 'invalid-timestamp'])(
    'rejects invalid annotation fields before consumers receive them: %s',
    async kind => {
      const f = await fixture()
      const id = crypto.randomUUID()
      f.provider.document.getMap(YDOC_CHANGES).set(
        id,
        new Y.Map<unknown>([
          ['docId', f.docId],
          ['type', 'insert'],
          ['userId', f.user.id],
          ['ts', kind === 'invalid-timestamp' ? 8.64e15 + 1 : Date.now()],
          [
            'start',
            kind === 'malformed-anchor'
              ? new Uint8Array([255])
              : encodeAnchor(f.ytext, 0, 0),
          ],
          ['end', encodeAnchor(f.ytext, 1, -1)],
        ])
      )
      expect(await f.closed).toBe(FORCED_CLOSE_REASONS.invalidUpdate)
      expect(
        await app.ctx.realtime.withProjectDoc(f.projectId, live =>
          live.getMap(YDOC_CHANGES).has(id)
        )
      ).toBe(false)
    }
  )

  it('rejects deeply nested awareness before scratch state is allocated', async () => {
    const f = await fixture()
    let value: unknown = 'leaf'
    for (let i = 0; i < 40; i++) value = { child: value }
    f.provider.awareness?.setLocalState({ value })
    expect(await f.closed).toBe(FORCED_CLOSE_REASONS.stateTooLarge)
    const document = app.ctx.realtime.hocuspocus.documents.get(
      projectDocumentName(f.projectId)
    )
    expect(
      document?.awareness.getStates().get(f.provider.document.clientID)
    ).not.toEqual({ value })
    expect(
      (await as(app, f.owner)({ method: 'GET', url: '/api/auth/me' }))
        .statusCode
    ).toBe(200)
  })

  it('allows existing awareness replacements and wire-null removals at the active-state cap', async () => {
    const f = await fixture()
    const document = app.ctx.realtime.hocuspocus.documents.get(
      projectDocumentName(f.projectId)
    )
    const awareness = f.provider.awareness
    if (!document || !awareness) throw new Error('Missing awareness')
    const limit = app.ctx.config.maxRealtimeConnectionsPerUser * 2 + 1
    const ids = Array.from(
      { length: limit - document.awareness.getStates().size },
      (_, i) => 910_000 + i
    )
    for (const id of ids) {
      document.awareness.getStates().set(id, { name: 'existing state' })
      document.awareness.meta.set(id, { clock: 1, lastUpdated: Date.now() })
    }
    expect(document.awareness.getStates().size).toBe(limit)
    for (const field of ['updated', 'removed'] as const) {
      const id = ids[field === 'updated' ? 1 : 0] as number
      const done = Promise.withResolvers<void>()
      const listener = (changes: { updated: number[]; removed: number[] }) => {
        if (changes[field].includes(id)) done.resolve()
      }
      const closed = ({ event }: { event: { reason: string } }) =>
        done.reject(new Error(event.reason))
      document.awareness.on('update', listener)
      f.provider.on('close', closed)
      try {
        if (field === 'updated')
          awareness.getStates().set(id, { name: 'replacement' })
        else awareness.getStates().delete(id)
        awareness.meta.set(id, { clock: 2, lastUpdated: Date.now() })
        f.socket.send(
          new OutgoingMessage(f.provider.effectiveName)
            .createAwarenessUpdateMessage(awareness, [id])
            .toUint8Array()
        )
        await done.promise
        expect(document.awareness.getStates().size).toBe(
          field === 'updated' ? limit : limit - 1
        )
      } finally {
        document.awareness.off('update', listener)
        f.provider.off('close', closed)
      }
    }
  })

  it('caps active and pending multiplexed project leases before loading another document', async () => {
    const f = await fixture()
    const hocuspocus = app.ctx.realtime.hocuspocus
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = await createProject(app, f.owner)
      ids.push(id)
    }
    await app.ctx.realtime.flushAll()
    for (const id of ids) {
      const name = projectDocumentName(id)
      const document = hocuspocus.documents.get(name)
      if (document) await hocuspocus.unloadDocument(document)
      expect(hocuspocus.documents.has(name)).toBe(false)
    }
    const pending = new Set<string>()
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const extension = {
      priority: -1000,
      async onLoadDocument({ documentName }: { documentName: string }) {
        if (
          !ids.slice(0, 3).some(id => projectDocumentName(id) === documentName)
        )
          return
        pending.add(documentName)
        if (pending.size === 3) started.resolve()
        await gate.promise
      },
    }
    const extensions = hocuspocus.configuration.extensions
    extensions.push(extension)
    try {
      for (const id of ids.slice(0, 3)) {
        const provider = new HocuspocusProvider({
          websocketProvider: f.provider.configuration.websocketProvider,
          name: projectDocumentName(id),
          token: 'cookie',
        })
        providers.push(provider)
        provider.attach()
      }
      await started.promise
      const rejectedId = ids[3] as string
      const provider = new HocuspocusProvider({
        websocketProvider: f.provider.configuration.websocketProvider,
        name: projectDocumentName(rejectedId),
        token: 'cookie',
      })
      providers.push(provider)
      provider.attach()
      expect(await f.closed).toBe(FORCED_CLOSE_REASONS.rateLimited)
      expect(
        hocuspocus.loadingDocuments.has(projectDocumentName(rejectedId))
      ).toBe(false)
      expect(hocuspocus.documents.has(projectDocumentName(rejectedId))).toBe(
        false
      )
    } finally {
      gate.resolve()
      await Promise.allSettled(hocuspocus.loadingDocuments.values())
      extensions.splice(extensions.indexOf(extension), 1)
    }
  })

  it('closes the raw upgrade socket on logout, not only its document protocol', async () => {
    const f = await fixture()
    const closed = Promise.withResolvers<{ code: number; reason: string }>()
    f.socket.once('close', (code, reason) =>
      closed.resolve({ code, reason: reason.toString() })
    )
    expect(
      (
        await as(
          app,
          f.user
        )({ method: 'POST', url: '/api/auth/logout', payload: {} })
      ).statusCode
    ).toBe(200)
    expect(await closed.promise).toEqual({
      code: 4401,
      reason: 'Not logged in',
    })
  })
})
