import fs from 'node:fs'
import path from 'node:path'
import { YDOC_TEXTS } from '@openleaf/shared'
import git from 'isomorphic-git'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Y from 'yjs'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

type Version = {
  oid: string
  source: string
  message: string
  authors: { id: string | null; name: string }[]
  changes: { path: string; op: string }[]
  labels: { name: string }[]
}

describe('history', async () => {
  const { app, dataDir } = await createTestApp()
  const user = await registerUser(app, 'Hedy')
  const req = as(app, user)
  const projectId = await createProject(app, user, 'example')
  const base = `/api/projects/${projectId}`
  const tree = await getTree(app, user, projectId)
  const mainId = tree.entries.find(e => e.name === 'main.tex')?.id as string
  const bibId = tree.entries.find(e => e.name === 'references.bib')
    ?.id as string
  const marker = path.join(dataDir, 'git', `${projectId}.git`, 'openleaf-dirty')

  const textOf = (docId: string) =>
    app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(docId)?.toString()
    )
  /** Edits as a user connection would (not `system`), which marks history dirty. */
  const userEdit = (docId: string, insert: string) =>
    app.ctx.realtime.withProjectDoc(
      projectId,
      doc => doc.getMap<Y.Text>(YDOC_TEXTS).get(docId)?.insert(0, insert),
      { userId: user.id, role: 'owner' }
    )
  const versions = async () =>
    (await req({ method: 'GET', url: `${base}/history` })).json()
      .versions as Version[]

  const originalMain = (await textOf(mainId)) as string
  const originalBib = (await textOf(bibId)) as string

  it('records the creation and flushes pending edits when listing', async () => {
    await userEdit(mainId, '% edited\n')
    await new Promise(r => setTimeout(r, 50))
    expect(app.ctx.history.isDirty(projectId)).toBe(true)
    expect(fs.existsSync(marker)).toBe(true)

    const list = await versions()
    expect(list.map(v => v.source)).toEqual(['auto', 'create'])
    expect(list[0].changes).toEqual([{ path: 'main.tex', op: 'modified' }])
    expect(list[0].message).toBe('Edits by Hedy')
    expect(list[0].authors).toEqual([{ id: user.id, name: 'Hedy' }])
    expect(list[1].changes).toEqual([
      { path: 'main.tex', op: 'added' },
      { path: 'references.bib', op: 'added' },
    ])
    expect(fs.existsSync(marker)).toBe(false)
    expect(app.ctx.history.isDirty(projectId)).toBe(false)

    const file = await req({
      method: 'GET',
      url: `${base}/history/${list[1].oid}/file?path=main.tex`,
    })
    expect(file.body).toBe(originalMain)
    const files = (
      await req({ method: 'GET', url: `${base}/history/${list[1].oid}/tree` })
    ).json().files
    expect(
      files.map((f: { path: string; kind: string }) => [f.path, f.kind])
    ).toEqual([
      ['main.tex', 'text'],
      ['references.bib', 'text'],
    ])
  })

  it('restores a whole version and keeps labels', async () => {
    const [, first] = await versions()
    const label = await req({
      method: 'POST',
      url: `${base}/history/labels`,
      payload: { oid: first.oid, name: 'Submitted' },
    })
    expect(label.statusCode).toBe(201)
    await userEdit(bibId, '% bib edit\n')

    const res = await req({
      method: 'POST',
      url: `${base}/history/${first.oid}/restore`,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(await textOf(mainId)).toBe(originalMain)
    expect(await textOf(bibId)).toBe(originalBib)

    const list = await versions()
    expect(list[0].source).toBe('restore')
    expect(list[0].message).toBe(`Restore to version ${first.oid.slice(0, 7)}`)
    expect(
      list.find(v => v.oid === first.oid)?.labels.map(l => l.name)
    ).toEqual(['Submitted'])
    expect(list.map(v => v.source)).toEqual([
      'restore',
      'auto',
      'auto',
      'create',
    ])
  })

  it('restores a single file without touching others', async () => {
    const first = (await versions()).at(-1) as Version
    await userEdit(mainId, '% main change\n')
    await userEdit(bibId, '% bib change\n')
    const res = await req({
      method: 'POST',
      url: `${base}/history/${first.oid}/restore`,
      payload: { path: 'references.bib' },
    })
    expect(res.statusCode).toBe(200)
    expect(await textOf(bibId)).toBe(originalBib)
    expect(await textOf(mainId)).toBe(`% main change\n${originalMain}`)
    const [latest] = await versions()
    expect(latest.source).toBe('restore')
    expect(latest.changes).toEqual([{ path: 'references.bib', op: 'modified' }])

    const missing = await req({
      method: 'POST',
      url: `${base}/history/${first.oid}/restore`,
      payload: { path: 'nope.tex' },
    })
    expect(missing.statusCode).toBe(404)
  })
})

describe('history auto-commit timing', async () => {
  const { app } = await createTestApp()
  const user = await registerUser(app, 'Timer')
  const projectId = await createProject(app, user)
  const mainId = (await getTree(app, user, projectId)).entries.find(
    e => e.name === 'main.tex'
  )?.id as string
  const history = app.ctx.history

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** A real edit (system context, so only the explicit markDirty counts). */
  const edit = (text: string) =>
    app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.insert(0, text)
    )
  /** Waits for the notification emitted after the actual commit is durable. */
  function nextCommit() {
    const committed = Promise.withResolvers<void>()
    const broadcast = app.ctx.realtime.broadcast
    vi.spyOn(app.ctx.realtime, 'broadcast').mockImplementation((id, event) => {
      broadcast(id, event)
      if (id === projectId && event.type === 'history.committed')
        committed.resolve()
    })
    return committed.promise
  }
  const commitCount = async () =>
    (await git.log({ fs, gitdir: history.gitdir(projectId), ref: 'main' }))
      .length

  it('commits 30 s after the last edit', async () => {
    const before = await commitCount()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const committed = nextCommit()
    await edit('% one\n')
    history.markDirty(projectId, user.id)
    vi.advanceTimersByTime(20_000)
    history.markDirty(projectId, user.id) // restarts the idle window
    vi.advanceTimersByTime(29_999)
    expect(history.isDirty(projectId)).toBe(true)
    vi.advanceTimersByTime(1)
    await committed
    expect(history.isDirty(projectId)).toBe(false)
    expect(await commitCount()).toBe(before + 1)
  })

  it('commits after 5 minutes of continuous editing', async () => {
    const before = await commitCount()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const committed = nextCommit()
    await edit('% two\n')
    history.markDirty(projectId, user.id)
    // An edit every 20 s never leaves a 30 s idle gap.
    for (let elapsed = 20_000; elapsed < 300_000; elapsed += 20_000) {
      vi.advanceTimersByTime(20_000)
      history.markDirty(projectId, user.id)
    }
    expect(history.isDirty(projectId)).toBe(true)
    vi.advanceTimersByTime(20_000) // reaches the 5-minute cap
    await committed
    expect(history.isDirty(projectId)).toBe(false)
    expect(await commitCount()).toBe(before + 1)
  })
})
