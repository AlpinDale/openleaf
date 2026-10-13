import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider'
import { projectDocumentName, YDOC_TEXTS } from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import git from 'isomorphic-git'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { buildApp } from '../src/app.js'
import { projectYdocs } from '../src/db/schema.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

const signature = {
  name: 'Git client',
  email: 'git@example.com',
  timestamp: 1,
  timezoneOffset: 0,
}

async function pushedCommit(
  gitdir: string,
  before: string,
  main: string,
  extra = false
) {
  const previous = await git.readCommit({ fs, gitdir, oid: before })
  const oldTree = await git.readTree({ fs, gitdir, oid: previous.commit.tree })
  const tree = oldTree.tree.filter(entry => entry.path !== 'main.tex')
  tree.push({
    mode: '100644',
    type: 'blob',
    path: 'main.tex',
    oid: await git.writeBlob({ fs, gitdir, blob: Buffer.from(main) }),
  })
  if (extra)
    tree.push({
      mode: '100644',
      type: 'blob',
      path: 'new.tex',
      oid: await git.writeBlob({
        fs,
        gitdir,
        blob: Buffer.from('New document\n'),
      }),
    })
  const treeOid = await git.writeTree({ fs, gitdir, tree })
  return git.writeCommit({
    fs,
    gitdir,
    commit: {
      tree: treeOid,
      parent: [before],
      author: signature,
      committer: signature,
      message: 'Git change',
    },
  })
}

function persistedText(app: FastifyInstance, projectId: string, docId: string) {
  const row = app.ctx.db
    .select()
    .from(projectYdocs)
    .where(eq(projectYdocs.projectId, projectId))
    .get()
  if (!row) throw new Error('Missing persisted project state')
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, row.state)
    return doc.getMap<Y.Text>(YDOC_TEXTS).get(docId)?.toString()
  } finally {
    doc.destroy()
  }
}

afterEach(() => vi.restoreAllMocks())

describe('durable Git receive and tree batches', () => {
  it.each(['before-import', 'after-durable-import'] as const)(
    'recovers an accepted push %s without duplicating document IDs or settings',
    async point => {
      const { app } = await createTestApp()
      const config = app.ctx.config
      const user = await registerUser(app)
      const id = await createProject(app, user, 'example')
      const beforeTree = await getTree(app, user, id)
      const mainId = beforeTree.entries.find(
        entry => entry.name === 'main.tex'
      )?.id
      const bibId = beforeTree.entries.find(
        entry => entry.name === 'references.bib'
      )?.id
      if (!mainId || !bibId) throw new Error('Missing example docs')
      await as(
        app,
        user
      )({
        method: 'PATCH',
        url: `/api/projects/${id}`,
        payload: { mainBibDocId: bibId },
      })
      const history = app.ctx.history
      const before = await history.headOid(id)
      if (!before) throw new Error('Missing initial HEAD')
      const oid = await pushedCommit(
        history.gitdir(id),
        before,
        'Git replacement\n',
        true
      )
      const journal = path.join(
        history.gitdir(id),
        'openleaf-receive-state.json'
      )
      let committedIds: Record<string, string> | undefined
      if (point === 'before-import') {
        app.ctx.db.$client.exec(
          "CREATE TRIGGER fail_new_doc BEFORE INSERT ON entries WHEN NEW.name = 'new.tex' BEGIN SELECT RAISE(ABORT, 'simulated import failure'); END"
        )
      } else {
        const rm = fsp.rm.bind(fsp)
        vi.spyOn(fsp, 'rm').mockImplementation(async (file, options) => {
          if (String(file) === journal)
            throw new Error('simulated journal cleanup failure')
          return rm(file, options)
        })
      }
      await expect(
        history.receivePush(id, async () => {
          const saved = JSON.parse(await fsp.readFile(journal, 'utf8'))
          expect(saved.beforeHead).toBe(before)
          expect(saved.docIdsByPath).toContainEqual(['main.tex', mainId])
          expect((await fsp.stat(journal)).mode & 0o777).toBe(0o600)
          expect(
            app.ctx.realtime.hocuspocus.documents.get(projectDocumentName(id))
              ?.clientID
          ).toBe(saved.clientId)
          await git.writeRef({
            fs,
            gitdir: history.gitdir(id),
            ref: 'refs/heads/main',
            value: oid,
            force: true,
          })
        })
      ).rejects.toThrow('simulated')
      expect(fs.existsSync(journal)).toBe(true)
      if (point === 'before-import') {
        expect(await getTree(app, user, id)).toEqual(beforeTree)
        expect(persistedText(app, id, mainId)).not.toBe('Git replacement\n')
        app.ctx.db.$client.exec('DROP TRIGGER fail_new_doc')
      } else {
        const current = await getTree(app, user, id)
        committedIds = Object.fromEntries(
          current.entries.map(entry => [entry.name, entry.id])
        )
        expect(persistedText(app, id, mainId)).toBe('Git replacement\n')
        expect(persistedText(app, id, committedIds['new.tex'])).toBe(
          'New document\n'
        )
      }
      vi.restoreAllMocks()
      await app.close()
      const reopened = await buildApp(config)
      try {
        const current = await getTree(reopened, user, id)
        const ids = Object.fromEntries(
          current.entries.map(entry => [entry.name, entry.id])
        )
        expect(current.entries).toHaveLength(3)
        expect(ids['main.tex']).toBe(mainId)
        expect(ids['references.bib']).toBe(bibId)
        if (committedIds) expect(ids).toEqual(committedIds)
        expect(persistedText(reopened, id, mainId)).toBe('Git replacement\n')
        expect(persistedText(reopened, id, ids['new.tex'])).toBe(
          'New document\n'
        )
        const details = (
          await as(
            reopened,
            user
          )({ method: 'GET', url: `/api/projects/${id}` })
        ).json()
        expect(details).toMatchObject({
          rootDocId: mainId,
          mainBibDocId: bibId,
        })
        expect(await reopened.ctx.history.headOid(id)).toBe(oid)
        expect(fs.existsSync(journal)).toBe(false)
      } finally {
        await reopened.close()
      }
    }
  )

  it('imports a changed ref even when the backend fails and preserves a UTF-8 BOM', async () => {
    const { app } = await createTestApp()
    const user = await registerUser(app)
    const id = await createProject(app, user)
    const mainId = (await getTree(app, user, id)).entries.find(
      entry => entry.name === 'main.tex'
    )?.id
    if (!mainId) throw new Error('Missing main doc')
    const history = app.ctx.history
    const before = await history.headOid(id)
    if (!before) throw new Error('Missing HEAD')
    const text = '\ufeffGit replacement\n'
    const oid = await pushedCommit(history.gitdir(id), before, text)
    await expect(
      history.receivePush(id, async () => {
        await git.writeRef({
          fs,
          gitdir: history.gitdir(id),
          ref: 'refs/heads/main',
          value: oid,
          force: true,
        })
        throw new Error('backend disconnected after accepting ref')
      })
    ).rejects.toThrow('backend disconnected')
    expect(persistedText(app, id, mainId)).toBe(text)
    const response = await as(
      app,
      user
    )({ method: 'GET', url: `/api/projects/${id}/files/${mainId}` })
    expect(response.rawPayload).toEqual(Buffer.from(text))
    expect(
      fs.existsSync(
        path.join(history.gitdir(id), 'openleaf-receive-state.json')
      )
    ).toBe(false)
  })

  it('merges a websocket edit queued during Git receive after the replacement lands', async () => {
    const { app } = await createTestApp()
    const user = await registerUser(app)
    const id = await createProject(app, user)
    const mainId = (await getTree(app, user, id)).entries.find(
      entry => entry.name === 'main.tex'
    )?.id
    if (!mainId) throw new Error('Missing main doc')
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing address')
    class CookieWebSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: { cookie: user.cookie } })
      }
    }
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${address.port}/collab`,
      WebSocketPolyfill:
        CookieWebSocket as unknown as typeof globalThis.WebSocket,
    })
    const synced = Promise.withResolvers<void>()
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: projectDocumentName(id),
      token: 'cookie',
      onSynced: () => synced.resolve(),
    })
    provider.attach()
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    let push: Promise<void> | undefined
    try {
      await synced.promise
      const history = app.ctx.history
      const before = await history.headOid(id)
      if (!before) throw new Error('Missing HEAD')
      const oid = await pushedCommit(
        history.gitdir(id),
        before,
        'Git replacement\n'
      )
      push = history.receivePush(id, async () => {
        started.resolve()
        await finish.promise
        await git.writeRef({
          fs,
          gitdir: history.gitdir(id),
          ref: 'refs/heads/main',
          value: oid,
          force: true,
        })
      })
      await started.promise
      const live = app.ctx.realtime.hocuspocus.documents.get(
        projectDocumentName(id)
      )
      const socket = live?.getConnections()[0]?.webSocket
      if (!(socket instanceof WebSocket))
        throw new Error('Missing server websocket')
      const arrived = Promise.withResolvers<void>()
      socket.once('message', () => arrived.resolve())
      const text = provider.document.getMap<Y.Text>(YDOC_TEXTS).get(mainId)
      if (!text) throw new Error('Missing synced text')
      text.insert(text.length, '\nQueued browser edit')
      await arrived.promise
      await setImmediate()
      expect(
        live?.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.toString()
      ).not.toContain('Queued browser edit')
      finish.resolve()
      await push
      await vi.waitFor(() => {
        const current = live?.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.toString()
        expect(current).toContain('Git replacement')
        expect(current).toContain('Queued browser edit')
        expect(text.toString()).toContain('Git replacement')
        expect(text.toString()).toContain('Queued browser edit')
      })
    } finally {
      finish.resolve()
      try {
        await push
      } finally {
        provider.destroy()
        websocketProvider.destroy()
      }
    }
  })
})
