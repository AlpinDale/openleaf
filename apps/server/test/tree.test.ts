import {
  encodeAnchor,
  resolveAnchor,
  YDOC_COMMENTS,
  YDOC_TEXTS,
} from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { commentThreads } from '../src/db/schema.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  multipart,
  registerUser,
} from './helpers.js'

describe('file tree', async () => {
  const { app } = await createTestApp()
  const user = await registerUser(app)
  const req = as(app, user)
  const projectId = await createProject(app, user)
  const base = `/api/projects/${projectId}`
  const docText = (docId: string) =>
    app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(docId)?.toString()
    )

  it('creates docs and rejects duplicate names with 409', async () => {
    const { rootFolderId } = await getTree(app, user, projectId)
    const payload = { parentId: rootFolderId, name: 'chapter.tex', kind: 'doc' }
    const first = await req({ method: 'POST', url: `${base}/entries`, payload })
    expect(first.statusCode).toBe(201)
    expect(await docText(first.json().entry.id)).toBe('')
    const second = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload,
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.existingEntryId).toBe(first.json().entry.id)
    const bad = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: { ...payload, name: 'a/b.tex' },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('refuses to move a folder into its own child', async () => {
    const { rootFolderId } = await getTree(app, user, projectId)
    const outer = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: { parentId: rootFolderId, name: 'outer', kind: 'folder' },
    })
    const inner = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: {
        parentId: outer.json().entry.id,
        name: 'inner',
        kind: 'folder',
      },
    })
    const res = await req({
      method: 'POST',
      url: `${base}/entries/${outer.json().entry.id}/move`,
      payload: { parentId: inner.json().entry.id },
    })
    expect(res.statusCode).toBe(400)
    const root = await req({
      method: 'DELETE',
      url: `${base}/entries/${rootFolderId}`,
      headers: { 'content-type': 'application/json' },
    })
    expect(root.statusCode).toBe(400)
  })

  it('uploads binaries and overwrites docs in place, preserving anchors', async () => {
    const tree = await getTree(app, user, projectId)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const upload = await req({
      method: 'POST',
      url: `${base}/upload`,
      ...(await multipart({ parentId: tree.rootFolderId }, [
        { name: 'fig.png', data: png },
      ])),
    })
    expect(upload.statusCode).toBe(200)
    const fig = upload.json().entries[0]
    expect(fig).toMatchObject({
      kind: 'file',
      name: 'fig.png',
      size: png.byteLength,
    })
    const download = await req({
      method: 'GET',
      url: `${base}/files/${fig.id}`,
    })
    expect(download.headers['content-type']).toBe('image/png')
    expect(new Uint8Array(download.rawPayload)).toEqual(png)

    const main = tree.entries.find(e => e.name === 'main.tex')
    if (!main) throw new Error('no main.tex')
    const original = (await docText(main.id)) as string
    const anchorIndex = 10
    const anchor = await app.ctx.realtime.withProjectDoc(projectId, doc =>
      encodeAnchor(
        doc.getMap<Y.Text>(YDOC_TEXTS).get(main.id) as Y.Text,
        anchorIndex,
        0
      )
    )
    const replacement = `${original.slice(0, 40)}% replaced\n\\end{document}\n`

    const clash = await req({
      method: 'POST',
      url: `${base}/upload`,
      ...(await multipart({ parentId: tree.rootFolderId }, [
        { name: 'main.tex', data: replacement },
      ])),
    })
    expect(clash.statusCode).toBe(409)
    expect(clash.json().error.existingEntryId).toBe(main.id)

    const overwrite = await req({
      method: 'POST',
      url: `${base}/upload`,
      ...(await multipart({ parentId: tree.rootFolderId, overwrite: 'true' }, [
        { name: 'main.tex', data: replacement },
      ])),
    })
    expect(overwrite.statusCode).toBe(200)
    expect(overwrite.json().entries[0].id).toBe(main.id)
    expect(await docText(main.id)).toBe(replacement)
    const resolved = await app.ctx.realtime.withProjectDoc(projectId, doc =>
      resolveAnchor(doc, anchor)
    )
    expect(resolved).toBe(anchorIndex)
  })

  it('rejects duplicate names in one upload and replaces folders on overwrite', async () => {
    const { rootFolderId } = await getTree(app, user, projectId)
    const dup = await req({
      method: 'POST',
      url: `${base}/upload`,
      ...(await multipart({ parentId: rootFolderId }, [
        { name: 'a.txt', data: 'one' },
        { name: 'a.txt', data: 'two' },
      ])),
    })
    expect(dup.statusCode).toBe(400)
    expect(
      (await getTree(app, user, projectId)).entries.some(
        e => e.name === 'a.txt'
      )
    ).toBe(false)

    const folder = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: { parentId: rootFolderId, name: 'notes', kind: 'folder' },
    })
    await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: {
        parentId: folder.json().entry.id,
        name: 'inside.tex',
        kind: 'doc',
      },
    })
    const upload = (overwrite: string) =>
      multipart({ parentId: rootFolderId, overwrite }, [
        { name: 'notes', data: 'plain notes' },
      ])
    const clash = await req({
      method: 'POST',
      url: `${base}/upload`,
      ...(await upload('false')),
    })
    expect(clash.statusCode).toBe(409)
    const replaced = await req({
      method: 'POST',
      url: `${base}/upload`,
      ...(await upload('true')),
    })
    expect(replaced.statusCode).toBe(200)
    const after = await getTree(app, user, projectId)
    expect(after.entries.find(e => e.name === 'notes')?.kind).toBe('file')
    expect(after.entries.some(e => e.name === 'inside.tex')).toBe(false)
  })

  it('deletes a folder together with its docs and their comments', async () => {
    const { rootFolderId } = await getTree(app, user, projectId)
    const folder = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: { parentId: rootFolderId, name: 'sections', kind: 'folder' },
    })
    const doc = await req({
      method: 'POST',
      url: `${base}/entries`,
      payload: {
        parentId: folder.json().entry.id,
        name: 'intro.tex',
        kind: 'doc',
      },
    })
    const docId = doc.json().entry.id as string
    const threadId = crypto.randomUUID()
    await app.ctx.realtime.withProjectDoc(projectId, ydoc => {
      const ytext = ydoc.getMap<Y.Text>(YDOC_TEXTS).get(docId) as Y.Text
      ytext.insert(0, 'Hello world')
      const comment = new Y.Map<unknown>()
      ydoc.getMap(YDOC_COMMENTS).set(threadId, comment)
      comment.set('docId', docId)
      comment.set('start', encodeAnchor(ytext, 0, 0))
      comment.set('end', encodeAnchor(ytext, 5, -1))
    })
    app.ctx.db
      .insert(commentThreads)
      .values({
        id: threadId,
        projectId,
        docId,
        createdBy: user.id,
        createdAt: Date.now(),
      })
      .run()

    const res = await req({
      method: 'DELETE',
      url: `${base}/entries/${folder.json().entry.id}`,
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(200)
    const after = await getTree(app, user, projectId)
    expect(after.entries.find(e => e.id === docId)).toBeUndefined()
    expect(
      app.ctx.db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, threadId))
        .all()
    ).toEqual([])
    const ystate = await app.ctx.realtime.withProjectDoc(projectId, ydoc => ({
      comment: ydoc.getMap(YDOC_COMMENTS).has(threadId),
      text: ydoc.getMap(YDOC_TEXTS).has(docId),
    }))
    expect(ystate).toEqual({ comment: false, text: false })
  })

  it('rejects URL imports that resolve to private addresses', async () => {
    const { rootFolderId } = await getTree(app, user, projectId)
    for (const url of [
      'http://127.0.0.1/x',
      'http://[::1]/x',
      'http://localhost/x',
    ]) {
      const res = await req({
        method: 'POST',
        url: `${base}/entries/import-url`,
        payload: { parentId: rootFolderId, name: 'x.txt', url },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toMatch(/private address/)
    }
    const ftp = await req({
      method: 'POST',
      url: `${base}/entries/import-url`,
      payload: {
        parentId: rootFolderId,
        name: 'x.txt',
        url: 'ftp://example.com/x',
      },
    })
    expect(ftp.statusCode).toBe(400)
  })
})
