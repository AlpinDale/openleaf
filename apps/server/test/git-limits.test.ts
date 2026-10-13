import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

const exec = promisify(execFile)
const { app } = await createTestApp({
  OPENLEAF_MAX_UPLOAD_MB: '0.1',
  OPENLEAF_MAX_PROJECT_STATE_MB: '0.0625',
})
await app.listen({ host: '127.0.0.1', port: 0 })
const address = app.server.address()
if (!address || typeof address === 'string') throw new Error('no address')
const port = address.port
const owner = await registerUser(app)
const token = (
  await as(
    app,
    owner
  )({
    method: 'POST',
    url: '/api/users/me/git-tokens',
    payload: { label: 'receive limits' },
  })
).json().token as string
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'openleaf-git-limits-'))
afterAll(() => fs.rmSync(work, { recursive: true, force: true }))

async function git(args: string[], cwd?: string) {
  try {
    const result = await exec('git', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
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
    return { code: 0, ...result }
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string }
    return result
  }
}

async function gitBytes(
  args: string[],
  input: Uint8Array | string,
  cwd: string
) {
  const result = exec('git', args, {
    cwd,
    encoding: 'buffer',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  result.child.stdin?.end(input)
  return (await result).stdout
}

async function rejectedPush(addFiles: (dir: string) => void, reason: RegExp) {
  const id = await createProject(app, owner)
  const dir = path.join(work, id)
  const url = `http://x:${token}@127.0.0.1:${port}/git/${id}`
  const clone = await git(['clone', url, dir])
  expect(clone.code, clone.stderr).toBe(0)
  const oldHead = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim()
  addFiles(dir)
  expect((await git(['add', '-A'], dir)).code).toBe(0)
  const commit = await git(['commit', '-m', 'Rejected import'], dir)
  expect(commit.code, commit.stderr).toBe(0)
  const push = await git(['push', 'origin', 'HEAD:main'], dir)
  expect(push.code).not.toBe(0)
  expect(push.stderr).toMatch(reason)
  const remote = await git(['ls-remote', 'origin', 'refs/heads/main'], dir)
  expect(remote.stdout.trim()).toBe(`${oldHead}\trefs/heads/main`)
  expect(
    (await getTree(app, owner, id)).entries
      .filter(entry => entry.kind !== 'folder')
      .map(entry => entry.name)
  ).toEqual(['main.tex'])
  expect(
    (await as(app, owner)({ method: 'GET', url: '/api/auth/me' })).json().user
      .id
  ).toBe(owner.id)
}

describe('Git receive resource and path limits', () => {
  it('rejects a highly compressed oversized blob before advancing main', async () => {
    await rejectedPush(dir => {
      fs.writeFileSync(path.join(dir, 'large.bin'), Buffer.alloc(1024 * 1024))
    }, /blob exceeds decoded size limit/)
  })

  it('rejects a tree with more than 2000 files before advancing main', async () => {
    await rejectedPush(dir => {
      for (let index = 0; index < 2001; index++) {
        fs.writeFileSync(path.join(dir, `file-${index}.txt`), 'x')
      }
    }, /too many project files/)
  })

  it('counts implied directories against the tip budget before importing SQL rows', async () => {
    await rejectedPush(dir => {
      for (let index = 0; index < 1000; index++) {
        const folder = path.join(dir, `folder-${index}`)
        fs.mkdirSync(folder)
        fs.writeFileSync(path.join(folder, 'image.png'), Buffer.from([0]))
      }
    }, /too many project entries/)
  })

  it('bounds cumulative decoded bytes even when every individual file fits', async () => {
    await rejectedPush(dir => {
      const bytes = Buffer.alloc(90 * 1024, 'x')
      for (let index = 0; index < 8; index++) {
        fs.writeFileSync(path.join(dir, `part-${index}.bin`), bytes)
      }
    }, /project exceeds decoded total size limit/)
  })

  it('rejects filenames the application cannot represent instead of dropping them', async () => {
    await rejectedPush(dir => {
      fs.writeFileSync(path.join(dir, 'bad:name.tex'), 'text')
    }, /invalid filename/)
  })

  it('rejects projected Y state beyond its quota before refs or live text change', async () => {
    await rejectedPush(dir => {
      fs.writeFileSync(path.join(dir, 'large.tex'), 'x'.repeat(96 * 1024))
    }, /project state exceeds configured quota/)
  })

  it('rejects regular-file modes pointing to non-blob objects before advancing main', async () => {
    const id = await createProject(app, owner)
    const dir = path.join(work, id)
    const url = `http://x:${token}@127.0.0.1:${port}/git/${id}`
    const clone = await git(['clone', url, dir])
    expect(clone.code, clone.stderr).toBe(0)
    const oldHead = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim()
    const tree = Buffer.concat([
      Buffer.from('100644 wrong.png\0'),
      Buffer.from(oldHead, 'hex'),
    ])
    const treeOid = (
      await gitBytes(
        ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'],
        tree,
        dir
      )
    )
      .toString()
      .trim()
    const commit = await git(
      ['commit-tree', treeOid, '-p', oldHead, '-m', 'Invalid object type'],
      dir
    )
    expect(commit.code, commit.stderr).toBe(0)
    const newHead = commit.stdout.trim()
    const pack = await gitBytes(
      ['pack-objects', '--stdout', '--window=0'],
      `${newHead}\n${treeOid}\n`,
      dir
    )
    const update = `${oldHead} ${newHead} refs/heads/main\0report-status side-band-64k\n`
    const body = Buffer.concat([
      Buffer.from(
        (Buffer.byteLength(update) + 4).toString(16).padStart(4, '0')
      ),
      Buffer.from(update),
      Buffer.from('0000'),
      pack,
    ])
    const response = await fetch(
      `http://127.0.0.1:${port}/git/${id}/git-receive-pack`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`x:${token}`).toString('base64')}`,
          'content-type': 'application/x-git-receive-pack-request',
        },
        body,
        signal: AbortSignal.timeout(30_000),
      }
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('ng refs/heads/main')
    const remote = await git(['ls-remote', 'origin', 'refs/heads/main'], dir)
    expect(remote.stdout.trim()).toBe(`${oldHead}\trefs/heads/main`)
    expect(
      (await getTree(app, owner, id)).entries
        .filter(entry => entry.kind !== 'folder')
        .map(entry => entry.name)
    ).toEqual(['main.tex'])
  })

  it('keeps legacy custom hooks untouched but does not execute them during a valid push', async () => {
    const legacyUpdate = path.join(
      app.ctx.config.dataDir,
      'git-hooks',
      'update'
    )
    const marker = path.join(work, 'legacy-hook-executed')
    fs.writeFileSync(
      legacyUpdate,
      `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 1\n`,
      { mode: 0o755 }
    )
    const id = await createProject(app, owner)
    const dir = path.join(work, id)
    const clone = await git([
      'clone',
      `http://x:${token}@127.0.0.1:${port}/git/${id}`,
      dir,
    ])
    expect(clone.code, clone.stderr).toBe(0)
    fs.writeFileSync(path.join(dir, 'good.png'), Buffer.from([0]))
    expect((await git(['add', '-A'], dir)).code).toBe(0)
    expect((await git(['commit', '-m', 'Valid import'], dir)).code).toBe(0)
    const push = await git(['push', 'origin', 'HEAD:main'], dir)
    expect(push.code, push.stderr).toBe(0)
    expect(
      (await getTree(app, owner, id)).entries
        .filter(entry => entry.kind !== 'folder')
        .map(entry => entry.name)
        .sort()
    ).toEqual(['good.png', 'main.tex'])
    expect(fs.existsSync(marker)).toBe(false)
    expect(fs.existsSync(legacyUpdate)).toBe(true)
  })
})
