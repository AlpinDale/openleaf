import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { blobPath } from '../src/tree/blobs.js'
import {
  as,
  createTestApp,
  getTree,
  multipart,
  registerUser,
  treePaths,
} from './helpers.js'

function buildZip(add: (zip: yazl.ZipFile) => void): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  add(zip)
  zip.end()
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    zip.outputStream.on('data', c => chunks.push(c))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
}

function unzip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      const files = new Map<string, Buffer>()
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e)
          const chunks: Buffer[] = []
          stream.on('data', c => chunks.push(c))
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(files))
      zip.readEntry()
    })
  })
}

const MAIN =
  '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n'
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
])

describe('zip import/export', async () => {
  const { app, dataDir } = await createTestApp()
  const user = await registerUser(app)
  const req = as(app, user)

  async function importZip(bytes: Buffer, name: string) {
    const res = await req({
      method: 'POST',
      url: '/api/projects/import',
      ...(await multipart({}, [{ name, data: bytes }])),
    })
    expect(res.statusCode, res.body).toBe(201)
    return res.json().id as string
  }

  it('strips a shared top folder and skips junk and symlinks', async () => {
    const zip = await buildZip(z => {
      z.addBuffer(Buffer.from(MAIN), 'proj/main.tex')
      z.addBuffer(Buffer.from('junk'), 'proj/__MACOSX/x')
      z.addBuffer(Buffer.from('junk'), 'proj/.DS_Store')
      z.addBuffer(Buffer.from('/etc/passwd'), 'proj/link', { mode: 0o120777 })
      z.addBuffer(PNG, 'proj/img/a.png')
    })
    const id = await importZip(zip, 'My Paper.zip')
    const tree = await getTree(app, user, id)
    expect(treePaths(tree)).toEqual(['img/', 'img/a.png', 'main.tex'])
    const project = (
      await req({ method: 'GET', url: `/api/projects/${id}` })
    ).json()
    expect(project.name).toBe('My Paper')
    const main = tree.entries.find(e => e.name === 'main.tex')
    expect(project.rootDocId).toBe(main?.id)
    expect(main?.kind).toBe('doc')
  })

  it('round-trips export and re-import with identical paths and bytes', async () => {
    const zip = await buildZip(z => {
      z.addBuffer(Buffer.from(MAIN), 'main.tex')
      z.addBuffer(Buffer.from('@book{a, title={A}}\n'), 'refs/refs.bib')
      z.addBuffer(PNG, 'img/a.png')
    })
    const id = await importZip(zip, 'roundtrip.zip')
    const exported = await req({
      method: 'GET',
      url: `/api/projects/${id}/download.zip`,
    })
    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-disposition']).toContain(
      'filename="roundtrip.zip"'
    )
    const first = await unzip(exported.rawPayload)
    expect([...first.keys()].sort()).toEqual([
      'img/a.png',
      'main.tex',
      'refs/refs.bib',
    ])
    expect(first.get('main.tex')?.toString()).toBe(MAIN)
    expect(first.get('img/a.png')).toEqual(PNG)

    const again = await importZip(exported.rawPayload, 'roundtrip.zip')
    const second = await unzip(
      (await req({ method: 'GET', url: `/api/projects/${again}/download.zip` }))
        .rawPayload
    )
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort())
  })

  it('returns validation for invalid archives instead of a server error', async () => {
    const response = await req({
      method: 'POST',
      url: '/api/projects/import',
      ...(await multipart({}, [{ name: 'broken.zip', data: 'not a zip' }])),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation')
  })

  it('skips absolute paths instead of normalizing them into project entries', async () => {
    const zip = await buildZip(z => {
      z.addBuffer(Buffer.from('unsafe'), 'good/main.tex')
      z.addBuffer(Buffer.from(MAIN), 'main.tex')
    })
    const name = Buffer.from('good/main.tex')
    for (
      let offset = zip.indexOf(name);
      offset !== -1;
      offset = zip.indexOf(name, offset + name.length)
    ) {
      zip.set(Buffer.from('/bad/main.tex'), offset)
    }
    const id = await importZip(zip, 'absolute.zip')
    expect(treePaths(await getTree(app, user, id))).toEqual(['main.tex'])
  })

  it('releases earlier binary entries when a later compressed entry is corrupt', async () => {
    const binary = Buffer.from([0, 12, 23, 34, 45, 56])
    const zip = await buildZip(z => {
      z.addBuffer(binary, 'figure.png')
      z.addBuffer(Buffer.from('will be corrupted'), 'broken.bin')
    })
    const header = zip.indexOf(Buffer.from('broken.bin')) - 30
    const data =
      header +
      30 +
      zip.readUInt16LE(header + 26) +
      zip.readUInt16LE(header + 28)
    zip[data] = 0xff // Reserved DEFLATE block type.
    const response = await req({
      method: 'POST',
      url: '/api/projects/import',
      ...(await multipart({}, [{ name: 'broken-entry.zip', data: zip }])),
    })
    expect(response.statusCode).toBe(400)
    const hash = createHash('sha256').update(binary).digest('hex')
    expect(fs.existsSync(blobPath(dataDir, hash))).toBe(false)
  })

  it('counts implied folders against the import entry limit', async () => {
    const zip = await buildZip(z => {
      for (let i = 0; i < 1000; i++)
        z.addBuffer(Buffer.from([0, 1]), `folder-${i}/asset.bin`)
      z.addBuffer(Buffer.from(MAIN), 'main.tex')
    })
    const before = (await req({ method: 'GET', url: '/api/projects' })).json()
      .projects
    const response = await req({
      method: 'POST',
      url: '/api/projects/import',
      ...(await multipart({}, [{ name: 'folders.zip', data: zip }])),
    })
    expect(response.statusCode).toBe(413)
    expect(
      (await req({ method: 'GET', url: '/api/projects' })).json().projects
    ).toEqual(before)
  })

  it('rejects conflicting file and folder paths before publishing blobs', async () => {
    const binary = Buffer.from([0, 91, 92, 93])
    const zip = await buildZip(z => {
      z.addBuffer(binary, 'asset')
      z.addBuffer(Buffer.from([0, 7]), 'asset/child.bin')
      z.addBuffer(Buffer.from(MAIN), 'main.tex')
    })
    const response = await req({
      method: 'POST',
      url: '/api/projects/import',
      ...(await multipart({}, [{ name: 'collision.zip', data: zip }])),
    })
    expect(response.statusCode).toBe(400)
    expect(
      fs.existsSync(
        blobPath(dataDir, createHash('sha256').update(binary).digest('hex'))
      )
    ).toBe(false)
  })

  it('limits collected text before allocating a project state and releases staged binaries', async () => {
    const { app: small, dataDir: smallDataDir } = await createTestApp({
      OPENLEAF_MAX_PROJECT_STATE_MB: '0.004',
    })
    const smallUser = await registerUser(small)
    const binary = Buffer.from([0, 81, 82, 83])
    const zip = await buildZip(z => {
      z.addBuffer(binary, 'staged.bin')
      z.addBuffer(Buffer.alloc(3000, 'a'), 'one.tex')
      z.addBuffer(Buffer.alloc(3000, 'b'), 'two.tex')
    })
    const request = as(small, smallUser)
    const response = await request({
      method: 'POST',
      url: '/api/projects/import',
      ...(await multipart({}, [{ name: 'text-limit.zip', data: zip }])),
    })
    expect(response.statusCode).toBe(413)
    expect(
      (await request({ method: 'GET', url: '/api/projects' })).json().projects
    ).toEqual([])
    expect(
      fs.existsSync(
        blobPath(
          smallDataDir,
          createHash('sha256').update(binary).digest('hex')
        )
      )
    ).toBe(false)
  })

  it('rejects zips that are too large when uncompressed', async () => {
    const { app: small } = await createTestApp({
      OPENLEAF_MAX_UPLOAD_MB: '0.01',
    })
    const smallUser = await registerUser(small)
    const zip = await buildZip(z =>
      z.addBuffer(Buffer.alloc(200_000), 'big.bin')
    )
    const form = await multipart({}, [{ name: 'big.zip', data: zip }])
    const res = await as(
      small,
      smallUser
    )({ method: 'POST', url: '/api/projects/import', ...form })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('too_large')
  })
})
