import fs from 'node:fs'
import { YDOC_TEXTS } from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type * as Y from 'yjs'
import { projectMembers, projects } from '../src/db/schema.js'
import { ExportService } from '../src/export/service.js'
import { replaceYText } from '../src/realtime/ydoc-text.js'
import { projectLock } from '../src/tree/locks.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  multipart,
  registerUser,
} from './helpers.js'

// 1×1 transparent PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
)

describe('exports (pandoc)', async () => {
  const { app } = await createTestApp()
  const owner = await registerUser(app, 'Ada Lovelace')
  const req = as(app, owner)
  const example = await createProject(app, owner, 'example', 'Export Me')

  const exportAs = (projectId: string, format: string, user = owner) =>
    as(
      app,
      user
    )({
      method: 'GET',
      url: `/api/projects/${projectId}/export.${format}`,
    })

  async function addDoc(projectId: string, name: string, text: string) {
    const tree = await getTree(app, owner, projectId)
    const res = await req({
      method: 'POST',
      url: `/api/projects/${projectId}/entries`,
      payload: { parentId: tree.rootFolderId, name, kind: 'doc' },
    })
    expect(res.statusCode).toBe(201)
    await setDoc(projectId, res.json().entry.id, text)
  }

  async function setDoc(projectId: string, docId: string, text: string) {
    await app.ctx.realtime.withProjectDoc(projectId, doc =>
      replaceYText(doc.getMap<Y.Text>(YDOC_TEXTS).get(docId) as Y.Text, text)
    )
  }

  async function setMain(projectId: string, text: string) {
    const tree = await getTree(app, owner, projectId)
    const main = tree.entries.find(e => e.name === 'main.tex')
    if (!main) throw new Error('no main.tex')
    await setDoc(projectId, main.id, text)
  }

  it('reports the converter in /api/config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ exports: true, supportUrl: null })
  })

  it('exports the example project to docx', async () => {
    const res = await exportAs(example, 'docx')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('wordprocessingml')
    expect(res.headers['content-disposition']).toContain('Export Me.docx')
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('exports the example project to markdown with citations', async () => {
    const res = await exportAs(example, 'md')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Introduction')
    expect(res.body).toContain('Mathematics')
    // references.bib is resolved by citeproc
    expect(res.body).toContain('Knuth')
  })

  it('exports the example project to standalone html', async () => {
    const res = await exportAs(example, 'html')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toMatch(/<html[\s>]/)
    expect(res.body).toMatch(/<h1[^>]*>.*Export Me/s)
    expect(res.body).toContain('Introduction')
    expect(res.body).not.toMatch(/<(link|script)[^>]+(href|src)="http/)
  })

  it('inlines \\input docs and embeds project images', async () => {
    const id = await createProject(app, owner, 'blank', 'With assets')
    const tree = await getTree(app, owner, id)
    const upload = await multipart({ parentId: tree.rootFolderId }, [
      { name: 'dot.png', data: PNG },
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
    await addDoc(id, 'chapter.tex', 'Chapter body sentence.\n')
    await setMain(
      id,
      '\\documentclass{article}\n\\begin{document}\n\\section{Start}\n\\input{chapter}\n% \\input{missing}\n\\includegraphics{dot}\n\\end{document}\n'
    )
    const html = await exportAs(id, 'html')
    expect(html.statusCode).toBe(200)
    expect(html.body).toContain('Chapter body sentence.')
    expect(html.body).toContain('data:image/png;base64,')
    const docx = await exportAs(id, 'docx')
    expect(docx.rawPayload.includes(Buffer.from('word/media/'))).toBe(true)
  })

  it('never reads files outside the project', async () => {
    const secret = fs.readFileSync('/etc/passwd', 'utf8')
    const marker = secret.split('\n').find(l => /^\w+:/.test(l)) as string
    expect(marker).toBeTruthy()
    const id = await createProject(app, owner, 'blank', 'Leaky')
    await setMain(
      id,
      [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Leak}',
        '\\input{/etc/passwd}',
        '\\include{../../../../../../etc/passwd}',
        '\\verbatiminput{/etc/passwd}',
        '\\lstinputlisting{/etc/passwd}',
        '\\includegraphics{/etc/passwd}',
        '\\includegraphics{../../../../../../etc/passwd}',
        '\\end{document}',
      ].join('\n')
    )
    for (const format of ['md', 'html']) {
      const res = await exportAs(id, format)
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Leak')
      expect(res.body).not.toContain(marker)
    }
    const docx = await exportAs(id, 'docx')
    expect(docx.statusCode).toBe(200)
    expect(docx.rawPayload.includes(Buffer.from('word/media/'))).toBe(false)
  })

  it('lets viewers export and hides the project from non-members', async () => {
    const viewer = await registerUser(app)
    app.ctx.db
      .insert(projectMembers)
      .values({
        projectId: example,
        userId: viewer.id,
        role: 'viewer',
        createdAt: Date.now(),
      })
      .run()
    expect((await exportAs(example, 'md', viewer)).statusCode).toBe(200)

    const stranger = await registerUser(app)
    const res = await exportAs(example, 'md', stranger)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })

  it('rejects unknown formats', async () => {
    expect((await exportAs(example, 'pdf')).statusCode).toBe(404)
  })

  it('keeps unrelated exports live and closes without waiting for a Git/tree lock', async () => {
    const blockedId = await createProject(app, owner)
    const blockedProject = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, blockedId))
      .get()
    const otherProject = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, example))
      .get()
    if (!blockedProject || !otherProject)
      throw new Error('missing fixture project')
    const service = new ExportService(
      {
        ...app.ctx,
        config: { ...app.ctx.config, maxConcurrentCompiles: 1 },
      },
      app.log
    )
    const mutex = projectLock(blockedId)
    const release = await mutex.acquire()
    const attempted = Promise.withResolvers<void>()
    const acquire = mutex.acquire.bind(mutex)
    const spy = vi.spyOn(mutex, 'acquire').mockImplementation(() => {
      attempted.resolve()
      return acquire()
    })
    const blocked = service.export(blockedProject, 'md').catch(error => error)
    try {
      await attempted.promise
      const other = await service.export(otherProject, 'md')
      expect(other.toString('utf8')).toContain('Introduction')
      await service.close()
      expect(await blocked).toMatchObject({ statusCode: 404 })
      expect(mutex.isLocked()).toBe(true)
    } finally {
      spy.mockRestore()
      release()
      await service.close()
      await blocked
      await mutex.waitForUnlock()
    }
  })
})

describe('exports without pandoc', async () => {
  const { app } = await createTestApp({
    OPENLEAF_PANDOC: '/nonexistent/pandoc',
    OPENLEAF_SUPPORT_URL: 'https://support.example.com/',
  })
  const owner = await registerUser(app)
  const id = await createProject(app, owner)

  it('reports exports unavailable and answers 503', async () => {
    const config = await app.inject({ method: 'GET', url: '/api/config' })
    expect(config.json()).toEqual({
      exports: false,
      supportUrl: 'https://support.example.com/',
    })
    const res = await as(
      app,
      owner
    )({ method: 'GET', url: `/api/projects/${id}/export.docx` })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('converter_unavailable')
  })
})
