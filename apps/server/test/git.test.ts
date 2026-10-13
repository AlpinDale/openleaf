import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { YDOC_TEXTS } from '@openleaf/shared'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type * as Y from 'yjs'
import { projectMembers } from '../src/db/schema.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
  type TestUser,
  treePaths,
} from './helpers.js'

const exec = promisify(execFile)

async function gitCli(args: string[], cwd?: string) {
  try {
    const { stdout, stderr } = await exec('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Git User',
        GIT_AUTHOR_EMAIL: 'git@example.com',
        GIT_COMMITTER_NAME: 'Git User',
        GIT_COMMITTER_EMAIL: 'git@example.com',
      },
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string }
    return { code: e.code, stdout: e.stdout, stderr: e.stderr }
  }
}

describe('git integration', async () => {
  const { app } = await createTestApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  const origin = `127.0.0.1:${address.port}`

  const owner = await registerUser(app, 'Grace')
  const projectId = await createProject(app, owner, 'example')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'openleaf-git-'))
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }))

  async function tokenFor(user: TestUser) {
    const res = await as(
      app,
      user
    )({
      method: 'POST',
      url: '/api/users/me/git-tokens',
      payload: { label: 'test' },
    })
    return res.json().token as string
  }
  const url = (token: string) => `http://x:${token}@${origin}/git/${projectId}`
  const docText = async (name: string) => {
    const tree = await getTree(app, owner, projectId)
    const id = tree.entries.find(e => e.name === name)?.id as string
    return app.ctx.realtime.withProjectDoc(projectId, doc =>
      doc.getMap<Y.Text>(YDOC_TEXTS).get(id)?.toString()
    )
  }

  const token = await tokenFor(owner)
  const clone = path.join(work, 'clone')

  it('clones the live project', async () => {
    const res = await gitCli(['clone', url(token), clone])
    expect(res.code, res.stderr).toBe(0)
    expect(
      fs
        .readdirSync(clone)
        .filter(f => f !== '.git')
        .sort()
    ).toEqual(['main.tex', 'references.bib'])
    expect(fs.readFileSync(path.join(clone, 'main.tex'), 'utf8')).toBe(
      await docText('main.tex')
    )
  })

  it('imports a push into the project', async () => {
    fs.appendFileSync(path.join(clone, 'main.tex'), '% pushed from git\n')
    fs.writeFileSync(path.join(clone, 'new.tex'), '\\section{New}\n')
    await gitCli(['add', '-A'], clone)
    await gitCli(['commit', '-m', 'Local edit'], clone)
    const push = await gitCli(['push', 'origin', 'HEAD:main'], clone)
    expect(push.code, push.stderr).toBe(0)
    expect(await docText('main.tex')).toMatch(/% pushed from git\n$/)
    expect(await docText('new.tex')).toBe('\\section{New}\n')
    expect(treePaths(await getTree(app, owner, projectId))).toEqual([
      'main.tex',
      'new.tex',
      'references.bib',
    ])
    const versions = (
      await as(
        app,
        owner
      )({ method: 'GET', url: `/api/projects/${projectId}/history` })
    ).json().versions
    expect(versions[0].source).toBe('git')
    expect(versions[0].authors).toEqual([{ id: null, name: 'Git User' }])
  })

  it('rejects a push when the project changed in the browser', async () => {
    const tree = await getTree(app, owner, projectId)
    const mainId = tree.entries.find(e => e.name === 'main.tex')?.id as string
    await app.ctx.realtime.withProjectDoc(
      projectId,
      doc =>
        doc.getMap<Y.Text>(YDOC_TEXTS).get(mainId)?.insert(0, '% browser\n'),
      { userId: owner.id, role: 'owner' }
    )
    fs.appendFileSync(path.join(clone, 'new.tex'), 'more\n')
    await gitCli(['commit', '-am', 'Second'], clone)
    const push = await gitCli(['push', 'origin', 'HEAD:main'], clone)
    expect(push.code).not.toBe(0)
    expect(push.stderr).toMatch(
      /changes newer than your last pull|non-fast-forward|fetch first|rejected/
    )
    expect(await docText('main.tex')).toMatch(/^% browser\n/)
  })

  it('requires a valid token and editor role to push', async () => {
    const bad = await gitCli(['ls-remote', url('olg_wrong')])
    expect(bad.code).not.toBe(0)
    const res = await fetch(
      `http://${origin}/git/${projectId}/info/refs?service=git-upload-pack`,
      {
        headers: {
          authorization: `Basic ${Buffer.from('x:olg_wrong').toString('base64')}`,
        },
      }
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="OpenLeaf"')

    const viewer = await registerUser(app, 'Viewer')
    app.ctx.db
      .insert(projectMembers)
      .values({
        projectId,
        userId: viewer.id,
        role: 'viewer',
        createdAt: Date.now(),
      })
      .run()
    const viewerToken = await tokenFor(viewer)
    const duplicateService = await fetch(
      `http://${origin}/git/${projectId}/info/refs?service=git-upload-pack&service=git-receive-pack`,
      {
        headers: {
          authorization: `Basic ${Buffer.from(`x:${viewerToken}`).toString('base64')}`,
        },
      }
    )
    expect(duplicateService.status).toBe(200)
    expect(duplicateService.headers.get('content-type')).toContain(
      'git-upload-pack-advertisement'
    )
    expect(await duplicateService.text()).not.toContain(
      '# service=git-receive-pack'
    )
    const viewerClone = path.join(work, 'viewer')
    expect((await gitCli(['clone', url(viewerToken), viewerClone])).code).toBe(
      0
    )
    const refs = await fetch(
      `http://${origin}/git/${projectId}/info/refs?service=git-receive-pack`,
      {
        headers: {
          authorization: `Basic ${Buffer.from(`x:${viewerToken}`).toString('base64')}`,
        },
      }
    )
    expect(refs.status).toBe(403)
    fs.writeFileSync(path.join(viewerClone, 'viewer.tex'), 'x\n')
    await gitCli(['add', '-A'], viewerClone)
    await gitCli(['commit', '-m', 'viewer'], viewerClone)
    const push = await gitCli(['push', 'origin', 'HEAD:main'], viewerClone)
    expect(push.code).not.toBe(0)
    expect(push.stderr).toMatch(/403/)
  })

  it('rejects non-Git bodies and oversized declared streaming packs', async () => {
    const authorization = `Basic ${Buffer.from(`x:${token}`).toString('base64')}`
    const invalid = await app.inject({
      method: 'POST',
      url: `/git/${projectId}/git-receive-pack`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: {},
    })
    expect(invalid.statusCode).toBe(415)
    const oversized = await app.inject({
      method: 'POST',
      url: `/git/${projectId}/git-receive-pack`,
      headers: {
        authorization,
        'content-type': 'application/x-git-receive-pack-request',
        'content-length': String(100 * 1024 * 1024 + 1),
      },
      payload: '0000',
    })
    expect(oversized.statusCode).toBe(413)
  })

  it('drains an unfinished Git upload during application shutdown', async () => {
    const { app: isolated } = await createTestApp()
    const user = await registerUser(isolated)
    const id = await createProject(isolated, user)
    const head = await isolated.ctx.history.headOid(id)
    const handoff = path.join(
      isolated.ctx.history.gitdir(id),
      'openleaf-receive-state.json'
    )
    const tokenResponse = await as(
      isolated,
      user
    )({
      method: 'POST',
      url: '/api/users/me/git-tokens',
      payload: { label: 'shutdown' },
    })
    await isolated.listen({ port: 0, host: '127.0.0.1' })
    const address = isolated.server.address()
    if (!address || typeof address === 'string')
      throw new Error('missing listener')
    const started = Promise.withResolvers<void>()
    const original = isolated.ctx.history.receivePush.bind(isolated.ctx.history)
    const spy = vi
      .spyOn(isolated.ctx.history, 'receivePush')
      .mockImplementation((projectId, runBackend) =>
        original(projectId, () => {
          const backend = runBackend()
          started.resolve()
          return backend
        })
      )
    const incoming = Promise.withResolvers<IncomingMessage>()
    isolated.server.once('request', request => incoming.resolve(request))
    const clientClosed = Promise.withResolvers<void>()
    const client = httpRequest(
      `http://127.0.0.1:${address.port}/git/${id}/git-receive-pack`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`x:${tokenResponse.json().token}`).toString('base64')}`,
          'content-type': 'application/x-git-receive-pack-request',
        },
      },
      response => response.resume()
    )
    client.on('error', () => {})
    client.once('close', () => clientClosed.resolve())
    try {
      // An incomplete packet keeps git waiting on stdin; no timer/sleep guesses.
      client.write('00')
      await started.promise
      const request = await incoming.promise
      expect(request.complete).toBe(false)
      expect(fs.existsSync(handoff)).toBe(true)
      await isolated.close()
      await clientClosed.promise
      expect(request.destroyed).toBe(true)
      expect(client.destroyed).toBe(true)
      expect(await isolated.ctx.history.headOid(id)).toBe(head)
      expect(fs.existsSync(handoff)).toBe(false)
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      client.destroy()
      spy.mockRestore()
      await isolated.close()
    }
  })
})
