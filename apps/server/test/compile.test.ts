import { YDOC_TEXTS } from '@openleaf/shared'
import { describe, expect, it } from 'vitest'
import type * as Y from 'yjs'
import { compileKey, materialize } from '../src/compile/materialize.js'
import { replaceYText } from '../src/realtime/ydoc-text.js'
import { projectSnapshot } from '../src/tree/snapshot.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  multipart,
  registerUser,
} from './helpers.js'

describe('compile (host runner)', async () => {
  const { app, dataDir } = await createTestApp()
  const user = await registerUser(app, 'Ada Lovelace')
  const req = as(app, user)

  async function setMain(projectId: string, text: string) {
    const tree = await getTree(app, user, projectId)
    const main = tree.entries.find(e => e.name === 'main.tex')
    if (!main) throw new Error('no main.tex')
    await app.ctx.realtime.withProjectDoc(projectId, doc =>
      replaceYText(doc.getMap<Y.Text>(YDOC_TEXTS).get(main.id) as Y.Text, text)
    )
  }

  const compile = (projectId: string, body: Record<string, boolean> = {}) =>
    req({
      method: 'POST',
      url: `/api/projects/${projectId}/compile`,
      payload: body,
    })

  it('compiles the example project and only rewrites changed files', async () => {
    const id = await createProject(app, user, 'example')
    const res = await compile(id)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('success')
    const paths = body.outputFiles.map((f: { path: string }) => f.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'output.pdf',
        'output.log',
        'output.synctex.gz',
        'output.bbl',
      ])
    )
    const pdf = body.outputFiles.find(
      (f: { path: string }) => f.path === 'output.pdf'
    )
    const download = await req({ method: 'GET', url: pdf.url })
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-type']).toBe('application/pdf')
    expect(download.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    const range = await req({
      method: 'GET',
      url: pdf.url,
      headers: { range: 'bytes=0-9' },
    })
    expect(range.statusCode).toBe(206)
    expect(range.rawPayload.byteLength).toBe(10)

    const again = await materialize(
      dataDir,
      compileKey(id, user.id),
      await projectSnapshot(app.ctx, id),
      { draft: false, rootDocPath: 'main.tex' }
    )
    expect({ written: again.written, deleted: again.deleted }).toEqual({
      written: 0,
      deleted: 0,
    })
  }, 120_000)

  it('still produces the PDF when an erroring project is recompiled unchanged', async () => {
    const id = await createProject(app, user)
    await setMain(
      id,
      '\\documentclass{article}\n\\begin{document}\n\\foo Hello\n\\end{document}\n'
    )
    for (let run = 0; run < 2; run++) {
      const body = (await compile(id)).json()
      expect(body.status, `run ${run}`).toBe('success')
      expect(body.outputFiles.map((f: { path: string }) => f.path)).toContain(
        'output.pdf'
      )
    }
  }, 60_000)

  it('reports failures with the log', async () => {
    const id = await createProject(app, user)
    await setMain(
      id,
      '\\documentclass{article}\n\\begin{document}\n\\undefinedcommand\n\\end{document}\n'
    )
    const res = await compile(id, { stopOnFirstError: true })
    const body = res.json()
    expect(body.status).toBe('failure')
    const log = body.outputFiles.find(
      (f: { path: string }) => f.path === 'output.log'
    )
    const text = (await req({ method: 'GET', url: log.url })).body
    expect(text).toContain('Undefined control sequence')
  }, 60_000)

  it('rejects a second concurrent compile for the same user with 409', async () => {
    const id = await createProject(app, user)
    const [a, b] = await Promise.all([compile(id), compile(id)])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    const conflict = a.statusCode === 409 ? a : b
    expect(conflict.json().error.code).toBe('compile_in_progress')
  }, 60_000)

  it('maps code to PDF and back with SyncTeX', async () => {
    const id = await createProject(app, user, 'example')
    expect((await compile(id)).json().status).toBe('success')
    const tree = await getTree(app, user, id)
    const main = tree.entries.find(e => e.name === 'main.tex')
    const text = await app.ctx.realtime.withProjectDoc(
      id,
      doc =>
        doc
          .getMap<Y.Text>(YDOC_TEXTS)
          .get(main?.id as string)
          ?.toString() as string
    )
    const line =
      text.split('\n').findIndex(l => l.includes('\\section{Introduction}')) + 1
    expect(line).toBeGreaterThan(0)
    const toPdf = await req({
      method: 'GET',
      url: `/api/projects/${id}/synctex/code?path=main.tex&line=${line}&column=0`,
    })
    expect(toPdf.statusCode).toBe(200)
    const box = toPdf.json().pdf[0]
    expect(box.page).toBe(1)
    const toCode = await req({
      method: 'GET',
      url: `/api/projects/${id}/synctex/pdf?page=${box.page}&h=${box.h + 1}&v=${box.v - 1}`,
    })
    expect(toCode.statusCode).toBe(200)
    const hit = toCode.json().code[0]
    expect(hit.path).toBe('main.tex')
    expect(Math.abs(hit.line - line)).toBeLessThanOrEqual(2)
    const outside = await req({
      method: 'GET',
      url: `/api/projects/${id}/synctex/code?path=..%2Foutside.tex&line=1`,
    })
    expect(outside.statusCode).toBe(404)
  }, 120_000)

  it('counts words', async () => {
    const id = await createProject(app, user)
    await setMain(
      id,
      '\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nOne two three $x$.\n\\end{document}\n'
    )
    const res = await req({
      method: 'GET',
      url: `/api/projects/${id}/wordcount`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      textWords: 3,
      headers: 1,
      mathInline: 1,
    })
  }, 60_000)
  it('does not mistake an uploaded output.pdf for a successful generated PDF', async () => {
    const id = await createProject(app, user)
    const tree = await getTree(app, user, id)
    const upload = await multipart({ parentId: tree.rootFolderId }, [
      { name: 'output.pdf', data: Buffer.from('%PDF-not-generated') },
    ])
    expect(
      (
        await req({
          method: 'POST',
          url: `/api/projects/${id}/upload`,
          ...upload,
        })
      ).statusCode
    ).toBe(200)
    const result = await compile(id)
    expect(result.statusCode).toBe(400)
    expect(result.json().error.message).toContain('reserved')
  })
})

describe('compile timeout', async () => {
  const { app } = await createTestApp({ OPENLEAF_COMPILE_TIMEOUT_SECONDS: '5' })
  const user = await registerUser(app)

  it('stops runaway compiles', async () => {
    const id = await createProject(app, user)
    const tree = await getTree(app, user, id)
    const main = tree.entries.find(e => e.name === 'main.tex')
    await app.ctx.realtime.withProjectDoc(id, doc =>
      replaceYText(
        doc.getMap<Y.Text>(YDOC_TEXTS).get(main?.id as string) as Y.Text,
        '\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}\n'
      )
    )
    const started = Date.now()
    const res = await as(
      app,
      user
    )({
      method: 'POST',
      url: `/api/projects/${id}/compile`,
      payload: {},
    })
    expect(res.json().status).toBe('timedout')
    expect(Date.now() - started).toBeLessThan(8000)
  }, 30_000)
})
