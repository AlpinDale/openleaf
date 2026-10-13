import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Mutex } from 'async-mutex'
import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/index.js'
import { entries } from '../db/schema.js'

export type BlobInfo = { hash: string; size: number; gitOid: string }

// Published uploads need protection until their entry is inserted (or rejected).
// Project locks protect existing references; these leases cover staged content.
const staged = new WeakMap<BlobInfo, string>()
const stagedCounts = new Map<string, number>()
const locks = new Map<string, { mutex: Mutex; users: number }>()

async function withBlobLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  let state = locks.get(path)
  if (!state) {
    state = { mutex: new Mutex(), users: 0 }
    locks.set(path, state)
  }
  state.users++
  try {
    return await state.mutex.runExclusive(fn)
  } finally {
    if (--state.users === 0) locks.delete(path)
  }
}

export const blobsDir = (dataDir: string) => path.join(dataDir, 'blobs')

export function blobPath(dataDir: string, hash: string) {
  return path.join(blobsDir(dataDir), hash.slice(0, 2), hash)
}

/** Relative path of a blob under `blobsDir` (for reply.sendFile). */
export const blobRelPath = (hash: string) => `${hash.slice(0, 2)}/${hash}`

/**
 * Stores content addressed by sha256 and returns its hashes. The git blob oid
 * (sha1 over `blob <size>\0` + bytes) is computed in the same pass, which needs
 * the size up front: buffers hash directly, streams hash the temp file again.
 */
export async function putBlob(
  dataDir: string,
  input: NodeJS.ReadableStream | Buffer | Uint8Array
): Promise<BlobInfo> {
  const dir = blobsDir(dataDir)
  const tmp = path.join(dir, `tmp-${crypto.randomUUID()}`)
  // A producer can fail while directory creation yields, before pipeline owns it.
  let inputError: Error | undefined
  const captureInputError = (error: Error) => {
    inputError = error
  }
  if (!(input instanceof Uint8Array)) input.on('error', captureInputError)
  try {
    await fsp.mkdir(dir, { recursive: true })
    if (inputError) throw inputError
    let info: BlobInfo
    if (input instanceof Uint8Array) {
      const bytes = Buffer.from(
        input.buffer,
        input.byteOffset,
        input.byteLength
      )
      await fsp.writeFile(tmp, bytes)
      info = {
        hash: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
        gitOid: gitBlobOid(bytes),
      }
    } else {
      const sha256 = createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          sha256.update(chunk)
          size += chunk.byteLength
          cb(null, chunk)
        },
      })
      await pipeline(input as Readable, meter, fs.createWriteStream(tmp))
      const sha1 = createHash('sha1').update(`blob ${size}\0`)
      for await (const chunk of fs.createReadStream(tmp)) {
        sha1.update(chunk as Buffer)
      }
      info = { hash: sha256.digest('hex'), size, gitOid: sha1.digest('hex') }
    }
    const dest = blobPath(dataDir, info.hash)
    return await withBlobLock(dest, async () => {
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      if (fs.existsSync(dest)) await fsp.rm(tmp, { force: true })
      else await fsp.rename(tmp, dest)
      stagedCounts.set(dest, (stagedCounts.get(dest) ?? 0) + 1)
      staged.set(info, dest)
      return info
    })
  } catch (err) {
    if (!(input instanceof Uint8Array)) (input as Readable).destroy()
    await fsp.rm(tmp, { force: true })
    throw err
  } finally {
    if (!(input instanceof Uint8Array))
      input.removeListener('error', captureInputError)
  }
}

export function gitBlobOid(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex')
}

export function readBlob(dataDir: string, hash: string): Promise<Buffer> {
  return fsp.readFile(blobPath(dataDir, hash))
}

export function blobStream(dataDir: string, hash: string): Readable {
  return fs.createReadStream(blobPath(dataDir, hash))
}

export async function deleteBlobIfUnreferenced(
  db: Db,
  dataDir: string,
  hash: string
) {
  const dest = blobPath(dataDir, hash)
  await withBlobLock(dest, () => deleteUnreferenced(db, dest, hash))
}

async function deleteUnreferenced(db: Db, dest: string, hash: string) {
  if (stagedCounts.has(dest)) return
  const n = db
    .select({ n: count() })
    .from(entries)
    .where(eq(entries.blobHash, hash))
    .get()?.n
  if (n === 0) await fsp.rm(dest, { force: true })
}

/** Ends the staging lifetime once content is referenced or its mutation failed. */
export async function releaseBlob(db: Db, dataDir: string, blob: BlobInfo) {
  const dest = staged.get(blob)
  if (!dest) return
  staged.delete(blob)
  await withBlobLock(dest, async () => {
    const remaining = (stagedCounts.get(dest) ?? 1) - 1
    if (remaining === 0) stagedCounts.delete(dest)
    else stagedCounts.set(dest, remaining)
    await deleteUnreferenced(db, blobPath(dataDir, blob.hash), blob.hash)
  })
}

/** Pins an existing blob while transferring it out of a locked source project. */
export async function retainBlob(
  dataDir: string,
  blob: BlobInfo
): Promise<BlobInfo> {
  const info = { hash: blob.hash, size: blob.size, gitOid: blob.gitOid }
  const dest = blobPath(dataDir, info.hash)
  return withBlobLock(dest, async () => {
    await fsp.access(dest)
    stagedCounts.set(dest, (stagedCounts.get(dest) ?? 0) + 1)
    staged.set(info, dest)
    return info
  })
}

export async function deleteBlobsIfUnreferenced(
  db: Db,
  dataDir: string,
  hashes: Iterable<string | null | undefined>
) {
  for (const hash of new Set(hashes)) {
    if (hash) await deleteBlobIfUnreferenced(db, dataDir, hash)
  }
}
