import { encodeAnchor, YDOC_COMMENTS, YDOC_TEXTS } from '@openleaf/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { entries, projectMembers } from '../src/db/schema.js'
import { projectLock } from '../src/tree/locks.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

describe('comments', async () => {
  const { app } = await createTestApp()
  const owner = await registerUser(app, 'Owner')
  const projectId = await createProject(app, owner)
  const tree = await getTree(app, owner, projectId)
  const docId = tree.entries.find(e => e.name === 'main.tex')?.id as string
  const base = `/api/projects/${projectId}/threads`
  const json = { 'content-type': 'application/json' }

  async function member(role: 'viewer' | 'reviewer' | 'editor', name: string) {
    const user = await registerUser(app, name)
    app.ctx.db
      .insert(projectMembers)
      .values({ projectId, userId: user.id, role, createdAt: Date.now() })
      .run()
    return user
  }

  it('creates threads, replies, resolves, and lists them with names', async () => {
    const reviewer = await member('reviewer', 'Rita')
    const id = crypto.randomUUID()
    const res = await as(
      app,
      reviewer
    )({
      method: 'POST',
      url: base,
      payload: { id, docId, content: 'First!' },
    })
    expect(res.statusCode).toBe(201)
    const dup = await as(
      app,
      reviewer
    )({
      method: 'POST',
      url: base,
      payload: { id, docId, content: 'again' },
    })
    expect(dup.statusCode).toBe(409)
    await as(
      app,
      owner
    )({
      method: 'POST',
      url: `${base}/${id}/messages`,
      payload: { content: 'Reply' },
    })
    await as(
      app,
      owner
    )({ method: 'POST', url: `${base}/${id}/resolve`, headers: json })
    const list = (await as(app, owner)({ method: 'GET', url: base })).json()
      .threads
    const thread = list.find((t: { id: string }) => t.id === id)
    expect(
      thread.messages.map((m: { userName: string; content: string }) => [
        m.userName,
        m.content,
      ])
    ).toEqual([
      ['Rita', 'First!'],
      ['Owner', 'Reply'],
    ])
    expect(thread.resolvedByName).toBe('Owner')
  })

  it('enforces roles and authorship', async () => {
    const viewer = await member('viewer', 'Vic')
    const denied = await as(
      app,
      viewer
    )({
      method: 'POST',
      url: base,
      payload: { id: crypto.randomUUID(), docId, content: 'nope' },
    })
    expect(denied.statusCode).toBe(403)

    const a = await member('reviewer', 'A')
    const b = await member('reviewer', 'B')
    const id = crypto.randomUUID()
    await as(
      app,
      a
    )({ method: 'POST', url: base, payload: { id, docId, content: 'mine' } })
    const messageId = (await as(app, a)({ method: 'GET', url: base }))
      .json()
      .threads.find((t: { id: string }) => t.id === id).messages[0].id
    const edit = await as(
      app,
      b
    )({
      method: 'PATCH',
      url: `${base}/${id}/messages/${messageId}`,
      payload: { content: 'hijack' },
    })
    expect(edit.statusCode).toBe(403)
    const del = await as(
      app,
      b
    )({ method: 'DELETE', url: `${base}/${id}`, headers: json })
    expect(del.statusCode).toBe(403)
  })

  it('rechecks membership after waiting for the project mutation lock', async () => {
    const reviewer = await member('reviewer', 'Waiting reviewer')
    const release = await projectLock(projectId).acquire()
    const pending = as(
      app,
      reviewer
    )({
      method: 'POST',
      url: base,
      payload: { id: crypto.randomUUID(), docId, content: 'revoked' },
    })
    // Let the request enter its handler and queue behind the held lock.
    const queued = Promise.withResolvers<void>()
    setImmediate(queued.resolve)
    await queued.promise
    app.ctx.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, reviewer.id)
        )
      )
      .run()
    release()
    expect((await pending).statusCode).toBe(404)
  })

  it('rejects a document deleted while thread creation waits for the lock', async () => {
    const created = await as(
      app,
      owner
    )({
      method: 'POST',
      url: `/api/projects/${projectId}/entries`,
      payload: {
        parentId: tree.rootFolderId,
        kind: 'doc',
        name: 'temporary.tex',
      },
    })
    const temporaryId = created.json().entry.id
    const release = await projectLock(projectId).acquire()
    const pending = as(
      app,
      owner
    )({
      method: 'POST',
      url: base,
      payload: {
        id: crypto.randomUUID(),
        docId: temporaryId,
        content: 'deleted',
      },
    })
    const queued = Promise.withResolvers<void>()
    setImmediate(queued.resolve)
    await queued.promise
    await app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap(YDOC_TEXTS).delete(temporaryId)
    )
    app.ctx.db.delete(entries).where(eq(entries.id, temporaryId)).run()
    release()
    expect((await pending).statusCode).toBe(400)
  })

  it('deleting a thread removes its Y anchor', async () => {
    const id = crypto.randomUUID()
    await app.ctx.realtime.withProjectDoc(projectId, doc => {
      const ytext = doc.getMap<Y.Text>(YDOC_TEXTS).get(docId) as Y.Text
      const anchor = new Y.Map<unknown>()
      doc.getMap(YDOC_COMMENTS).set(id, anchor)
      anchor.set('docId', docId)
      anchor.set('start', encodeAnchor(ytext, 0, 0))
      anchor.set('end', encodeAnchor(ytext, 4, -1))
    })
    await as(
      app,
      owner
    )({ method: 'POST', url: base, payload: { id, docId, content: 'x' } })
    const res = await as(
      app,
      owner
    )({ method: 'DELETE', url: `${base}/${id}`, headers: json })
    expect(res.statusCode).toBe(200)
    const hasAnchor = await app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap(YDOC_COMMENTS).has(id)
    )
    expect(hasAnchor).toBe(false)
    const list = (await as(app, owner)({ method: 'GET', url: base })).json()
      .threads
    expect(list.some((t: { id: string }) => t.id === id)).toBe(false)
  })
})
