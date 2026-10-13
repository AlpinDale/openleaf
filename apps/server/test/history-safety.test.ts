import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import git from 'isomorphic-git'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { users } from '../src/db/schema.js'
import { parseTrailers } from '../src/history/service.js'
import { createProjectFromFiles } from '../src/projects/service.js'
import { contentFromBytes } from '../src/tree/service.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

describe('history serialization and concurrency', async () => {
  const { app } = await createTestApp()
  const user = await registerUser(app)
  const history = app.ctx.history

  it('sanitizes existing user names before serializing Git identity headers', async () => {
    const name =
      'Ada\nparent deadbeef\ncommitter Spoof <evil@example.com>\u2028separator\u2029end'
    const malicious = await registerUser(app, 'Ada')
    app.ctx.db
      .update(users)
      .set({ name })
      .where(eq(users.id, malicious.id))
      .run()
    const id = await createProject(app, malicious)
    const oid = await history.headOid(id)
    if (!oid) throw new Error('Missing initial commit')
    const commit = await git.readCommit({ fs, gitdir: history.gitdir(id), oid })
    expect(commit.commit.author.name).toBe(
      'Ada parent deadbeef committer Spoof  evil@example.com  separator end'
    )
    expect(commit.commit.author.email).toBe(
      `${malicious.id}@users.openleaf.invalid`
    )
    expect(commit.commit.parent).toEqual([])
    const response = await as(
      app,
      malicious
    )({ method: 'GET', url: `/api/projects/${id}/history` })
    expect(response.statusCode).toBe(200)
    expect(response.json().versions[0].source).toBe('create')
  })

  it('uses only the final server trailer block, not project-controlled earlier text', async () => {
    const id = await createProjectFromFiles(app.ctx, {
      ownerId: user.id,
      name: 'Paper',
      source: 'import',
      message:
        'Import Paper\n\nOpenLeaf-Source: restore\nOpenLeaf-Authors: forged',
      files: [
        {
          path: 'main.tex',
          content: { kind: 'doc', text: '\\documentclass{article}' },
        },
      ],
    })
    const response = await as(
      app,
      user
    )({ method: 'GET', url: `/api/projects/${id}/history` })
    expect(response.statusCode).toBe(200)
    expect(response.json().versions[0]).toMatchObject({
      source: 'import',
      authors: [{ id: user.id }],
    })
    expect(
      parseTrailers(
        'Message\n\nOpenLeaf-Source: restore\nOpenLeaf-Authors: forged\n\nordinary prose'
      ).source
    ).toBe('git')
  })

  it('repairs every sensitive Git setting on an existing repository', async () => {
    const id = await createProject(app, user)
    const gitdir = history.gitdir(id)
    for (const [path, value] of [
      ['core.hooksPath', '/tmp/not-openleaf'],
      ['http.receivepack', 'false'],
      ['receive.denyNonFastForwards', 'false'],
      ['receive.denyDeletes', 'false'],
      ['receive.maxInputSize', '0'],
      ['core.useReplaceRefs', 'true'],
    ])
      await git.setConfig({ fs, gitdir, path, value })
    await history.ensureHead(id)
    for (const [path, value] of [
      ['core.hooksPath', history.hooksDir],
      ['http.receivepack', 'true'],
      ['receive.denyNonFastForwards', 'true'],
      ['receive.denyDeletes', 'true'],
      ['receive.maxInputSize', '100m'],
      ['core.useReplaceRefs', 'false'],
    ])
      expect(await git.getConfig({ fs, gitdir, path })).toBe(value)
  })

  it('keeps the marker when a new edit races the old marker unlink', async () => {
    const id = await createProject(app, user)
    const marker = `${history.gitdir(id)}/openleaf-dirty`
    const removing = barrier()
    const continueRemoval = barrier()
    const written = barrier()
    const rm = fsp.rm.bind(fsp)
    const write = fsp.writeFile.bind(fsp)
    vi.spyOn(fsp, 'rm').mockImplementation(async (file, options) => {
      if (String(file) === marker) {
        removing.resolve()
        await continueRemoval.promise
      }
      return rm(file, options)
    })
    vi.spyOn(fsp, 'writeFile').mockImplementation(
      async (file, data, options) => {
        await write(file, data, options)
        if (String(file) === marker) written.resolve()
      }
    )
    const clean = history.markClean(id, undefined)
    try {
      await removing.promise
      history.markDirty(id, user.id)
      await written.promise
    } finally {
      continueRemoval.resolve()
    }
    await clean
    expect(history.isDirty(id)).toBe(true)
    expect(history.hasMarker(id)).toBe(true)
  })

  it('keeps commits out of the entire Git receive lifecycle', async () => {
    const id = await createProject(app, user)
    const started = barrier()
    const finished = barrier()
    const push = history.receivePush(id, async () => {
      started.resolve()
      await finished.promise
    })
    await started.promise
    const commit = vi.spyOn(history, 'commitLocked')
    const pending = history.commit(id, { source: 'auto', authors: [] })
    try {
      await setImmediate()
      expect(commit).not.toHaveBeenCalled()
    } finally {
      finished.resolve()
      await Promise.all([push, pending])
    }
    expect(commit).toHaveBeenCalledOnce()
  })

  it('classifies invalid UTF-8 editable filenames as binary in history', async () => {
    const content = await contentFromBytes(
      app.ctx,
      'broken.tex',
      Buffer.from([0xff, 0])
    )
    const id = await createProjectFromFiles(app.ctx, {
      ownerId: user.id,
      name: 'Binary source',
      source: 'import',
      files: [{ path: 'broken.tex', content }],
    })
    const oid = await history.headOid(id)
    if (!oid) throw new Error('Missing commit')
    expect(await history.versionTree(id, oid)).toEqual([
      { path: 'broken.tex', kind: 'binary', size: 2 },
    ])
  })
  it('imports and lists native Git identities containing Unicode line separators', async () => {
    const id = await createProject(app, user)
    const gitdir = history.gitdir(id)
    const before = await history.headOid(id)
    if (!before) throw new Error('Missing HEAD')
    const current = await git.readCommit({ fs, gitdir, oid: before })
    const signature = {
      name: 'External\u2028Git\u2029author',
      email: 'external@example.com',
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: 0,
    }
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        tree: current.commit.tree,
        parent: [before],
        author: signature,
        committer: signature,
        message: 'Native identity',
      },
    })
    await history.receivePush(id, async () => {
      await git.writeRef({
        fs,
        gitdir,
        ref: 'refs/heads/main',
        value: oid,
        force: true,
      })
    })
    const response = await as(
      app,
      user
    )({ method: 'GET', url: `/api/projects/${id}/history` })
    expect(response.statusCode).toBe(200)
    expect(response.json().versions[0]).toMatchObject({
      oid,
      source: 'git',
      authors: [{ id: null, name: signature.name }],
    })
  })
})

describe('legacy Git object admission', async () => {
  const { app } = await createTestApp({ OPENLEAF_MAX_UPLOAD_MB: '0.001' })
  const user = await registerUser(app)
  const id = await createProject(app, user)
  const history = app.ctx.history
  const gitdir = history.gitdir(id)
  const signature = {
    name: 'Old Git client',
    email: 'old@example.com',
    timestamp: 1,
    timezoneOffset: 0,
  }

  it('rejects legacy file entries whose actual object type is not a blob before JS reads', async () => {
    const before = await history.headOid(id)
    if (!before) throw new Error('Missing HEAD')
    const tree = await git.writeTree({
      fs,
      gitdir,
      tree: [{ mode: '100644', type: 'blob', path: 'wrong.bin', oid: before }],
    })
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        tree,
        parent: [before],
        author: signature,
        committer: signature,
        message: 'Wrong object type',
      },
    })
    const reader = vi.spyOn(git, 'readBlob')
    await expect(history.versionTree(id, oid)).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(history.readVersionBlob(id, before)).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(reader).not.toHaveBeenCalled()
  })

  it('rejects old oversized compressed blobs before JS inflation or tree mutation', async () => {
    const blobOid = await git.writeBlob({
      fs,
      gitdir,
      blob: Buffer.alloc(20_000),
    })
    const tree = await git.writeTree({
      fs,
      gitdir,
      tree: [
        { mode: '100644', type: 'blob', path: 'oversized.bin', oid: blobOid },
      ],
    })
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        tree,
        parent: [],
        author: signature,
        committer: signature,
        message: 'Legacy oversized file',
      },
    })
    const before = await getTree(app, user, id)
    const reader = vi.spyOn(git, 'readBlob')
    await expect(history.versionTree(id, oid)).rejects.toMatchObject({
      statusCode: 413,
    })
    await expect(history.readVersionBlob(id, blobOid)).rejects.toMatchObject({
      statusCode: 413,
    })
    await expect(history.restore(id, user.id, oid)).rejects.toMatchObject({
      statusCode: 413,
    })
    expect(reader).not.toHaveBeenCalled()
    expect(await getTree(app, user, id)).toEqual(before)
  })

  it('rejects oversized legacy commit metadata before JS parsing', async () => {
    const head = await history.headOid(id)
    if (!head) throw new Error('Missing head')
    const existing = await git.readCommit({ fs, gitdir, oid: head })
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        tree: existing.commit.tree,
        parent: [],
        author: signature,
        committer: signature,
        message: 'm'.repeat(70_000),
      },
    })
    const reader = vi.spyOn(git, 'readCommit')
    await expect(history.versionTree(id, oid)).rejects.toMatchObject({
      statusCode: 413,
    })
    expect(reader).not.toHaveBeenCalled()
  })

  it('does not let legacy replacement refs disguise an oversized original blob', async () => {
    const large = await git.writeBlob({
      fs,
      gitdir,
      blob: Buffer.alloc(20_000),
    })
    const small = await git.writeBlob({ fs, gitdir, blob: Buffer.from('x') })
    await git.writeRef({
      fs,
      gitdir,
      ref: `refs/replace/${large}`,
      value: small,
      force: true,
    })
    await git.setConfig({
      fs,
      gitdir,
      path: 'core.useReplaceRefs',
      value: 'true',
    })
    const reader = vi.spyOn(git, 'readBlob')
    await expect(history.readVersionBlob(id, large)).rejects.toMatchObject({
      statusCode: 413,
    })
    expect(reader).not.toHaveBeenCalled()
  })

  it('keeps native history above Git-input count and cumulative byte limits readable', async () => {
    const blob = await git.writeBlob({
      fs,
      gitdir,
      blob: Buffer.from([0, 1, 2, 3]),
    })
    const tree = await git.writeTree({
      fs,
      gitdir,
      tree: Array.from({ length: 2001 }, (_, n) => ({
        mode: '100644',
        type: 'blob' as const,
        path: `file-${n}.bin`,
        oid: blob,
      })),
    })
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        tree,
        parent: [],
        author: signature,
        committer: signature,
        message: 'Large native project',
      },
    })
    expect(await history.versionTree(id, oid)).toHaveLength(2001)
    const reader = vi.spyOn(git, 'readBlob')
    await history.restore(id, user.id, oid)
    expect(await getTree(app, user, id)).toMatchObject({
      entries: expect.any(Array),
    })
    expect((await getTree(app, user, id)).entries).toHaveLength(2001)
    expect(reader).toHaveBeenCalledOnce()
  })
})
