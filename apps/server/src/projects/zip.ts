import { type Readable, Transform } from 'node:stream'
import { validateEntryName } from '@openleaf/shared'
import type { FastifyBaseLogger } from 'fastify'
import yauzl from 'yauzl'
import yazl from 'yazl'
import type { AppContext } from '../context.js'
import { badRequest, tooLarge } from '../errors.js'
import { blobStream, releaseBlob } from '../tree/blobs.js'
import { assertMaterializablePath } from '../tree/paths.js'
import { contentFromStream } from '../tree/service.js'
import type { SnapshotEntry } from '../tree/snapshot.js'
import type { NewProjectFile } from './service.js'

const MAX_ZIP_ENTRIES = 2000
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

type ZipItem = { entry: yauzl.Entry; path: string }

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: false, decodeStrings: false },
      (err, zip) => (err ? reject(err) : resolve(zip))
    )
  )
}

function readEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const out: yauzl.Entry[] = []
    zip.on('entry', (entry: yauzl.Entry) => {
      out.push(entry)
      if (out.length > MAX_ZIP_ENTRIES) {
        reject(
          tooLarge(`The zip file has more than ${MAX_ZIP_ENTRIES} entries`)
        )
        return
      }
      zip.readEntry()
    })
    zip.on('end', () => resolve(out))
    zip.on('error', () => reject(badRequest('Invalid zip file')))
    zip.readEntry()
  })
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) =>
      err ? reject(badRequest('Invalid zip entry')) : resolve(stream)
    )
  )
}

type RawEntry = yauzl.Entry & {
  fileNameRaw: Buffer
  extraFields: { id: number; data: Buffer }[]
}

const lowLevel = yauzl as unknown as {
  getFileNameLowLevel(
    flags: number,
    name: Buffer,
    extraFields: { id: number; data: Buffer }[],
    strictFileNames: boolean
  ): string
}

/**
 * Decodes the entry name ourselves (decodeStrings: false) so a single bad
 * name (absolute, `..`) is skipped instead of aborting the whole zip.
 */
function entryName(entry: yauzl.Entry): string {
  const raw = entry as RawEntry
  return lowLevel
    .getFileNameLowLevel(
      raw.generalPurposeBitFlag,
      raw.fileNameRaw,
      raw.extraFields,
      false
    )
    .replace(/\\/g, '/')
}

/** Reads a zip into project files, applying the import filters and limits. */
export async function readProjectZip(
  ctx: AppContext,
  file: string,
  log: FastifyBaseLogger
): Promise<{ files: NewProjectFile[]; emptyFolders: string[] }> {
  const maxTotal = ctx.config.maxUploadBytes * 6
  const zip = await openZip(file).catch(() => {
    throw badRequest('Invalid zip file')
  })
  const files: NewProjectFile[] = []
  try {
    const all = await readEntries(zip)
    let total = 0
    for (const entry of all) total += entry.uncompressedSize
    if (total > maxTotal)
      throw tooLarge('The zip file is too large when uncompressed')

    const items: ZipItem[] = []
    const folders: string[] = []
    for (const entry of all) {
      const name = entryName(entry)
      const segments = name.replace(/\/$/, '').split('/')
      if (segments.length === 0 || name === '') continue
      if (segments.includes('__MACOSX') || segments.at(-1) === '.DS_Store')
        continue
      if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) continue
      const invalid = segments.find(s => validateEntryName(s) !== null)
      if (invalid !== undefined) {
        log.warn({ path: name }, 'skipping zip entry with an invalid name')
        continue
      }
      if (name.endsWith('/')) folders.push(segments.join('/'))
      else items.push({ entry, path: segments.join('/') })
    }

    // Strip a single top-level folder shared by every path.
    const allPaths = [...items.map(i => i.path), ...folders]
    const first = allPaths[0]?.split('/')[0]
    const sharedTop =
      first !== undefined &&
      items.length > 0 &&
      items.every(i => i.path.startsWith(`${first}/`)) &&
      folders.every(f => f === first || f.startsWith(`${first}/`))
    const strip = (p: string) => (sharedTop ? p.slice(first.length + 1) : p)

    const filePaths = new Set<string>()
    const folderPaths = new Set<string>()
    const checkTreeLimit = () => {
      if (filePaths.size + folderPaths.size > MAX_ZIP_ENTRIES)
        throw tooLarge(
          `The imported tree has more than ${MAX_ZIP_ENTRIES} entries`
        )
    }
    for (const item of items) {
      const name = strip(item.path)
      assertMaterializablePath(ctx.config.dataDir, name)
      if (filePaths.has(name))
        throw badRequest('Zip contains duplicate file paths')
      filePaths.add(name)
      checkTreeLimit()
      const parts = name.split('/')
      for (let i = 1; i < parts.length; i++) {
        folderPaths.add(parts.slice(0, i).join('/'))
        checkTreeLimit()
      }
    }
    for (const folder of folders) {
      const name = strip(folder)
      if (!name) continue
      assertMaterializablePath(ctx.config.dataDir, name)
      const parts = name.split('/')
      for (let i = 1; i <= parts.length; i++) {
        folderPaths.add(parts.slice(0, i).join('/'))
        checkTreeLimit()
      }
    }
    for (const folder of folderPaths) {
      if (filePaths.has(folder))
        throw badRequest('Zip uses the same path for a file and a folder')
    }

    let read = 0
    let docBytes = 0
    for (const item of items) {
      const stream = await openEntry(zip, item.entry)
      const counted = countBytes(stream, n => {
        read += n
        if (read > maxTotal)
          throw tooLarge('The zip file is too large when uncompressed')
      })
      const content = await contentFromStream(ctx, item.path, counted)
      files.push({ path: strip(item.path), content })
      if (content.kind === 'doc') {
        docBytes += Buffer.byteLength(content.text)
        if (docBytes > ctx.config.maxProjectStateBytes)
          throw tooLarge('Imported documents exceed project state limit')
      }
    }
    const emptyFolders = folders.map(strip).filter(f => f !== '')
    return { files, emptyFolders }
  } catch (err) {
    for (const file of files) {
      if (file.content.kind === 'file')
        await releaseBlob(ctx.db, ctx.config.dataDir, file.content.blob)
    }
    throw err
  } finally {
    zip.close()
  }
}

/** Passes `stream` through, calling `onBytes` per chunk; a throw fails the stream. */
function countBytes(stream: Readable, onBytes: (n: number) => void): Transform {
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        onBytes(chunk.byteLength)
        callback(null, chunk)
      } catch (err) {
        callback(err as Error)
      }
    },
  })
  stream.on('error', () => meter.destroy(badRequest('Invalid zip entry')))
  meter.on('close', () => stream.destroy())
  return stream.pipe(meter)
}

/** Streams a zip of the given entries (docs from text, files from blobs). */
export function zipEntries(ctx: AppContext, list: SnapshotEntry[]): Readable {
  const zip = new yazl.ZipFile()
  const output = zip.outputStream as unknown as Readable
  const sources: Readable[] = []
  zip.on('error', err => output.destroy(err))
  output.on('close', () => {
    for (const source of sources) source.destroy()
  })
  for (const entry of list) {
    if (entry.kind === 'doc')
      zip.addBuffer(Buffer.from(entry.text, 'utf8'), entry.path)
    else if (entry.kind === 'file') {
      const source = blobStream(ctx.config.dataDir, entry.hash)
      source.on('error', err => output.destroy(err))
      sources.push(source)
      zip.addReadStream(source, entry.path)
    }
  }
  // Empty folders only (others are implied by their files).
  const used = new Set<string>()
  for (const entry of list) {
    if (entry.kind === 'folder') continue
    const parts = entry.path.split('/')
    for (let i = 1; i < parts.length; i++) used.add(parts.slice(0, i).join('/'))
  }
  for (const entry of list) {
    if (entry.kind === 'folder' && !used.has(entry.path))
      zip.addEmptyDirectory(entry.path)
  }
  zip.end()
  return output
}

export function zipFilename(name: string): string {
  return `${name.replace(/[/\\:*?"<>|]/g, '_')}.zip`
}

/** RFC 6266 Content-Disposition with an ASCII fallback. */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
