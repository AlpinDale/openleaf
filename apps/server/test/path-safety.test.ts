import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProjectFromFiles } from '../src/projects/service.js'
import { assertMaterializablePath } from '../src/tree/paths.js'
import { as, createTestApp, getTree, registerUser } from './helpers.js'

function pathOfBytes(bytes: number) {
  const parts: string[] = []
  while (bytes > 150) {
    const length = Math.min(150, bytes - 5)
    parts.push('d'.repeat(length))
    bytes -= length + 1
  }
  parts.push(`${'x'.repeat(bytes - 4)}.tex`)
  return parts.join('/')
}

describe('native materialization paths', async () => {
  const { app, dataDir } = await createTestApp()
  const user = await registerUser(app)
  const req = as(app, user)
  const nativeMax = process.platform === 'darwin' ? 1024 : 4096
  const budgetRoot =
    process.platform === 'darwin' ? fs.realpathSync.native(dataDir) : dataDir
  const maxRelative =
    nativeMax - Buffer.byteLength(budgetRoot) - '/compiles/'.length - 73 - 1 - 1
  it('accepts the native byte boundary and rejects the next byte before creation', async () => {
    const filePath = pathOfBytes(maxRelative)
    expect(() => assertMaterializablePath(dataDir, filePath)).not.toThrow()
    const key = `${crypto.randomUUID()}-${user.id}`
    const full = path.join(dataDir, 'compiles', key, filePath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'valid')
    expect(fs.readFileSync(full, 'utf8')).toBe('valid')
    await expect(
      createProjectFromFiles(app.ctx, {
        ownerId: user.id,
        name: 'Too long',
        source: 'import',
        files: [
          {
            path: pathOfBytes(maxRelative + 1),
            content: { kind: 'doc', text: 'unsafe' },
          },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    const response = await req({ method: 'GET', url: '/api/projects' })
    expect(response.json().projects).toEqual([])
  })

  it('checks every descendant before renaming or moving a folder', async () => {
    const prefix = 'p'.repeat(10)
    const filePath = `${prefix}/${pathOfBytes(maxRelative - prefix.length - 1)}`
    const id = await createProjectFromFiles(app.ctx, {
      ownerId: user.id,
      name: 'Long tree',
      source: 'import',
      files: [{ path: filePath, content: { kind: 'doc', text: 'content' } }],
    })
    const tree = await getTree(app, user, id)
    const folder = tree.entries.find(entry => entry.name === prefix)
    if (!folder) throw new Error('Missing folder')
    const rename = await req({
      method: 'POST',
      url: `/api/projects/${id}/entries/${folder.id}/rename`,
      payload: { name: `${prefix}x` },
    })
    expect(rename.statusCode).toBe(400)
    expect(await getTree(app, user, id)).toEqual(tree)
    const destination = await req({
      method: 'POST',
      url: `/api/projects/${id}/entries`,
      payload: { name: 'target', kind: 'folder', parentId: tree.rootFolderId },
    })
    expect(destination.statusCode).toBe(201)
    const beforeMove = await getTree(app, user, id)
    const move = await req({
      method: 'POST',
      url: `/api/projects/${id}/entries/${folder.id}/move`,
      payload: { parentId: destination.json().entry.id },
    })
    expect(move.statusCode).toBe(400)
    expect(await getTree(app, user, id)).toEqual(beforeMove)
  })
})
