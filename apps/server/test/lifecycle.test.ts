import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { YDOC_TEXTS } from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { entries, projects, projectYdocs } from '../src/db/schema.js'
import {
  createProjectFromFiles,
  deleteProject,
} from '../src/projects/service.js'
import {
  blobPath,
  blobsDir,
  deleteBlobIfUnreferenced,
  releaseBlob,
} from '../src/tree/blobs.js'
import { projectLock } from '../src/tree/locks.js'
import {
  applyTreeToProject,
  contentFromBytes,
  type ProjectFileContent,
  uploadFiles,
} from '../src/tree/service.js'
import { type ProjectSnapshot, projectSnapshot } from '../src/tree/snapshot.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  multipart,
  registerUser,
  treePaths,
} from './helpers.js'

describe('project data lifetime', async () => {
  const { app, dataDir } = await createTestApp({
    OPENLEAF_TEXLIVE_IMAGES: 'texlive/current:stable,texlive/previous:stable',
  })
  const user = await registerUser(app)
  const req = as(app, user)

  it('keeps a shared staged blob until every upload has released it', async () => {
    const projectId = await createProject(app, user)
    const { rootFolderId } = await getTree(app, user, projectId)
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const first = await contentFromBytes(app.ctx, 'first.png', bytes)
    const second = await contentFromBytes(app.ctx, 'second.png', bytes)
    if (first.kind !== 'file' || second.kind !== 'file')
      throw new Error('Expected binaries')
    try {
      await releaseBlob(app.ctx.db, dataDir, first.blob)
      await deleteBlobIfUnreferenced(app.ctx.db, dataDir, first.blob.hash)
      expect(fs.existsSync(blobPath(dataDir, first.blob.hash))).toBe(true)
      const [saved] = await uploadFiles(app.ctx, projectId, user.id, {
        parentId: rootFolderId,
        overwrite: false,
        files: [{ name: 'second.png', content: second }],
      })
      const response = await req({
        method: 'GET',
        url: `/api/projects/${projectId}/files/${saved.id}`,
      })
      expect(response.rawPayload).toEqual(bytes)
      await req({
        method: 'DELETE',
        url: `/api/projects/${projectId}/entries/${saved.id}`,
        headers: { 'content-type': 'application/json' },
      })
      expect(fs.existsSync(blobPath(dataDir, first.blob.hash))).toBe(false)
    } finally {
      await releaseBlob(app.ctx.db, dataDir, first.blob)
      await releaseBlob(app.ctx.db, dataDir, second.blob)
    }
  })

  it('does not collect a binary reused at a new path by whole-tree replacement', async () => {
    const projectId = await createProject(app, user)
    const { rootFolderId } = await getTree(app, user, projectId)
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5])
    const content = await contentFromBytes(app.ctx, 'before.png', bytes)
    const [saved] = await uploadFiles(app.ctx, projectId, user.id, {
      parentId: rootFolderId,
      overwrite: false,
      files: [{ name: 'before.png', content }],
    })
    const row = app.ctx.db
      .select()
      .from(entries)
      .where(eq(entries.id, saved.id))
      .get()
    if (!row?.blobHash || !row.gitOid) throw new Error('Expected stored blob')
    const files = new Map<string, ProjectFileContent>([
      [
        'after.png',
        {
          kind: 'binary',
          hash: row.blobHash,
          gitOid: row.gitOid,
          size: row.size,
        },
      ],
    ])
    await applyTreeToProject(app.ctx, projectId, files, { deleteMissing: true })
    const after = await getTree(app, user, projectId)
    expect(treePaths(after)).toEqual(['after.png'])
    const response = await req({
      method: 'GET',
      url: `/api/projects/${projectId}/files/${after.entries[0].id}`,
    })
    expect(response.rawPayload).toEqual(bytes)
    expect(fs.existsSync(blobPath(dataDir, row.blobHash))).toBe(true)
  })

  it('rejects an invalid replacement path before deleting live files', async () => {
    const projectId = await createProject(app, user)
    const before = await getTree(app, user, projectId)
    await expect(
      applyTreeToProject(
        app.ctx,
        projectId,
        new Map([
          ['../escape.tex', { kind: 'text' as const, text: 'not safe' }],
        ]),
        { deleteMissing: true }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(await getTree(app, user, projectId)).toEqual(before)
  })

  it('reads tree entries and Y text under the same project lock', async () => {
    const projectId = await createProject(app, user)
    const { rootFolderId } = await getTree(app, user, projectId)
    const release = await projectLock(projectId).acquire()
    const id = crypto.randomUUID()
    const now = Date.now()
    let resolved = false
    let snapshot: Promise<ProjectSnapshot> | undefined
    try {
      app.ctx.db
        .insert(entries)
        .values({
          id,
          projectId,
          parentId: rootFolderId,
          name: 'pending.tex',
          kind: 'doc',
          createdAt: now,
          updatedAt: now,
        })
        .run()
      snapshot = projectSnapshot(app.ctx, projectId).then(value => {
        resolved = true
        return value
      })
      await setImmediate()
      expect(resolved).toBe(false)
      await app.ctx.realtime.withProjectDoc(projectId, doc => {
        doc.getMap<Y.Text>(YDOC_TEXTS).set(id, new Y.Text('complete content'))
      })
    } finally {
      release()
    }
    if (!snapshot) throw new Error('Snapshot was not started')
    expect(
      (await snapshot).entries.find(entry => entry.id === id)
    ).toMatchObject({ kind: 'doc', text: 'complete content' })
  })

  it('preserves the selected TeX Live image on copy', async () => {
    const projectId = await createProject(app, user)
    await req({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      payload: { image: 'texlive/previous:stable' },
    })
    const copy = await req({
      method: 'POST',
      url: `/api/projects/${projectId}/copy`,
      payload: { name: 'Image copy' },
    })
    expect(copy.statusCode).toBe(201)
    const details = await req({
      method: 'GET',
      url: `/api/projects/${copy.json().id}`,
    })
    expect(details.json().image).toBe('texlive/previous:stable')
  })

  it('waits for active Git/history work and never recreates a deleted repo', async () => {
    const projectId = await createProject(app, user)
    app.ctx.history.markDirty(projectId, user.id)
    const release = await app.ctx.history.lock(projectId).acquire()
    let deleted = false
    const deletion = deleteProject(app.ctx, projectId).then(() => {
      deleted = true
    })
    try {
      await setImmediate()
      expect(deleted).toBe(false)
    } finally {
      release()
    }
    await deletion
    expect(
      app.ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
    ).toBeUndefined()
    await expect(app.ctx.history.ensureHead(projectId)).rejects.toMatchObject({
      statusCode: 404,
    })
    app.ctx.history.markDirty(projectId, user.id)
    await setImmediate()
    expect(app.ctx.history.isDirty(projectId)).toBe(false)
    expect(fs.existsSync(app.ctx.history.gitdir(projectId))).toBe(false)
  })

  it('deletes legacy deep trees without recursive foreign-key cascades', async () => {
    const projectId = await createProject(app, user)
    let parentId = (await getTree(app, user, projectId)).rootFolderId
    const now = Date.now()
    app.ctx.db.transaction(tx => {
      for (let i = 0; i < 1100; i++) {
        const id = crypto.randomUUID()
        tx.insert(entries)
          .values({
            id,
            projectId,
            parentId,
            name: 'd',
            kind: 'folder',
            createdAt: now,
            updatedAt: now,
          })
          .run()
        parentId = id
      }
    })
    await deleteProject(app.ctx, projectId)
    expect(
      app.ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
    ).toBeUndefined()
    expect(
      app.ctx.db
        .select()
        .from(entries)
        .where(eq(entries.projectId, projectId))
        .all()
    ).toEqual([])
  })

  it('clears an invalid main document and invalidates project settings on rename', async () => {
    const projectId = await createProject(app, user)
    const main = (await getTree(app, user, projectId)).entries.find(
      entry => entry.name === 'main.tex'
    )
    if (!main) throw new Error('Missing main doc')
    const rename = (name: string) =>
      req({
        method: 'POST',
        url: `/api/projects/${projectId}/entries/${main.id}/rename`,
        payload: { name },
      })
    expect((await rename('main.TEX')).statusCode).toBe(200)
    expect(
      (await req({ method: 'GET', url: `/api/projects/${projectId}` })).json()
        .rootDocId
    ).toBe(main.id)
    const events: string[] = []
    const broadcast = app.ctx.realtime.broadcast
    app.ctx.realtime.broadcast = (id, event) => {
      if (id === projectId) events.push(event.type)
      broadcast(id, event)
    }
    try {
      expect((await rename('main.txt')).statusCode).toBe(200)
      expect(
        (await req({ method: 'GET', url: `/api/projects/${projectId}` })).json()
          .rootDocId
      ).toBeNull()
      expect(events).toContain('project.updated')
      expect(
        (
          await req({
            method: 'PATCH',
            url: `/api/projects/${projectId}`,
            payload: { rootDocId: main.id },
          })
        ).statusCode
      ).toBe(400)
    } finally {
      app.ctx.realtime.broadcast = broadcast
    }
  })
  it('rolls back an entire upload batch without publishing Y changes or leaking blobs on SQL failure', async () => {
    const id = await createProject(app, user)
    const { rootFolderId } = await getTree(app, user, id)
    const before = await projectSnapshot(app.ctx, id)
    const persisted = app.ctx.db
      .select()
      .from(projectYdocs)
      .where(eq(projectYdocs.projectId, id))
      .get()
    if (!persisted) throw new Error('Missing persisted project state')
    const binary = Buffer.from([0, 71, 72, 73])
    app.ctx.db.$client.exec(`
      CREATE TRIGGER lifecycle_abort BEFORE INSERT ON entries
      WHEN NEW.name = 'fail.tex'
      BEGIN SELECT RAISE(ABORT, 'batch failure'); END
    `)
    try {
      const response = await req({
        method: 'POST',
        url: `/api/projects/${id}/upload`,
        ...(await multipart({ parentId: rootFolderId, overwrite: 'true' }, [
          {
            name: 'main.tex',
            data: Buffer.from('must not replace the live document'),
          },
          { name: 'staged.bin', data: binary },
          {
            name: 'fail.tex',
            data: Buffer.from('must not be partially created'),
          },
        ])),
      })
      expect(response.statusCode).toBe(500)
      expect(await projectSnapshot(app.ctx, id)).toEqual(before)
      expect(
        app.ctx.db
          .select()
          .from(projectYdocs)
          .where(eq(projectYdocs.projectId, id))
          .get()?.state
      ).toEqual(persisted.state)
      expect(
        fs.existsSync(
          blobPath(dataDir, createHash('sha256').update(binary).digest('hex'))
        )
      ).toBe(false)
    } finally {
      app.ctx.db.$client.exec('DROP TRIGGER lifecycle_abort')
    }
  })

  it.each(['renamed', 'deleted'] as const)(
    'revalidates settings after a queued main document is %s',
    async action => {
      const id = await createProject(app, user)
      const { rootFolderId } = await getTree(app, user, id)
      const created = await req({
        method: 'POST',
        url: `/api/projects/${id}/entries`,
        payload: { parentId: rootFolderId, kind: 'doc', name: 'candidate.tex' },
      })
      expect(created.statusCode).toBe(201)
      const candidateId = created.json().entry.id as string
      const before = app.ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .get()?.rootDocId
      const release = await projectLock(id).acquire()
      let settled = false
      const pending = req({
        method: 'PATCH',
        url: `/api/projects/${id}`,
        payload: { rootDocId: candidateId },
      }).then(response => {
        settled = true
        return response
      })
      try {
        await setImmediate()
        expect(settled).toBe(false)
        if (action === 'renamed') {
          app.ctx.db
            .update(entries)
            .set({ name: 'candidate.txt' })
            .where(eq(entries.id, candidateId))
            .run()
        } else {
          app.ctx.db.delete(entries).where(eq(entries.id, candidateId)).run()
          await app.ctx.realtime.withProjectDoc(id, doc =>
            doc.getMap<Y.Text>(YDOC_TEXTS).delete(candidateId)
          )
        }
      } finally {
        release()
      }
      expect((await pending).statusCode).toBe(400)
      expect(
        app.ctx.db.select().from(projects).where(eq(projects.id, id)).get()
          ?.rootDocId
      ).toBe(before)
    }
  )
})

describe('project state budgets', async () => {
  const { app, dataDir } = await createTestApp({
    OPENLEAF_MAX_PROJECT_STATE_MB: '0.004',
  })
  const user = await registerUser(app)
  const req = as(app, user)

  it('rejects initial project state before creating database or repo state', async () => {
    const before = app.ctx.db.select().from(projects).all().length
    await expect(
      createProjectFromFiles(app.ctx, {
        ownerId: user.id,
        name: 'Too large',
        source: 'import',
        files: [
          {
            path: 'main.tex',
            content: { kind: 'doc', text: 'x'.repeat(10_000) },
          },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 413 })
    expect(app.ctx.db.select().from(projects).all()).toHaveLength(before)
    expect(
      fs.existsSync(app.ctx.history.root)
        ? fs.readdirSync(app.ctx.history.root)
        : []
    ).toHaveLength(0)
  })

  it('rejects a multi-file upload without partial entries or orphaned binaries', async () => {
    const projectId = await createProject(app, user)
    const before = await getTree(app, user, projectId)
    const response = await req({
      method: 'POST',
      url: `/api/projects/${projectId}/upload`,
      ...(await multipart({ parentId: before.rootFolderId }, [
        { name: 'figure.png', data: Buffer.from([0, 1, 2, 3]) },
        { name: 'one.tex', data: 'x'.repeat(3000) },
        { name: 'two.tex', data: 'y'.repeat(3000) },
      ])),
    })
    expect(response.statusCode).toBe(413)
    expect(await getTree(app, user, projectId)).toEqual(before)
    const hash = createHash('sha256')
      .update(Buffer.from([0, 1, 2, 3]))
      .digest('hex')
    expect(fs.existsSync(blobPath(dataDir, hash))).toBe(false)
  })

  it('rejects whole-tree overflow without deleting the old main document', async () => {
    const projectId = await createProject(app, user)
    const before = await getTree(app, user, projectId)
    await expect(
      applyTreeToProject(
        app.ctx,
        projectId,
        new Map([
          [
            'oversized.tex',
            { kind: 'text' as const, text: 'z'.repeat(10_000) },
          ],
        ]),
        { deleteMissing: true }
      )
    ).rejects.toMatchObject({ statusCode: 413 })
    expect(await getTree(app, user, projectId)).toEqual(before)
    const details = await req({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    })
    expect(details.json().rootDocId).toBe(
      before.entries.find(entry => entry.name === 'main.tex')?.id
    )
  })
})

describe('multipart batch budgets', async () => {
  const { app, dataDir } = await createTestApp({
    OPENLEAF_MAX_UPLOAD_MB: String(1024 / (1024 * 1024)),
  })
  const user = await registerUser(app)
  const req = as(app, user)

  it.each([8, 9])(
    'bounds a batch of %i individually valid files',
    async count => {
      const projectId = await createProject(app, user)
      const before = await getTree(app, user, projectId)
      const files = Array.from({ length: count }, (_, index) => ({
        name: index === count - 1 ? 'notes.tex' : `file-${index}.bin`,
        data:
          index === count - 1
            ? Buffer.alloc(768, 't')
            : Buffer.alloc(768, count * 16 + index),
      }))
      const response = await req({
        method: 'POST',
        url: `/api/projects/${projectId}/upload`,
        ...(await multipart({ parentId: before.rootFolderId }, files)),
      })
      if (count === 8) {
        expect(response.statusCode, response.body).toBe(200)
        const tree = await getTree(app, user, projectId)
        expect(treePaths(tree)).toEqual(
          ['main.tex', ...files.map(file => file.name)].sort()
        )
        const binary = tree.entries.find(entry => entry.name === files[0].name)
        const downloaded = await req({
          method: 'GET',
          url: `/api/projects/${projectId}/files/${binary?.id}`,
        })
        expect(downloaded.rawPayload).toEqual(files[0].data)
      } else {
        expect(response.statusCode, response.body).toBe(413)
        expect(await getTree(app, user, projectId)).toEqual(before)
        for (const file of files.slice(0, -1)) {
          const hash = createHash('sha256').update(file.data).digest('hex')
          expect(fs.existsSync(blobPath(dataDir, hash))).toBe(false)
        }
        expect(
          fs
            .readdirSync(blobsDir(dataDir))
            .filter(name => name.startsWith('tmp-'))
        ).toEqual([])
      }
    }
  )
})
