import path from 'node:path'
import { type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { x } from 'tar'

const MAX_CACHE_FILES = 500
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_CACHE_BYTES = 1024 * 1024 * 1024

/** Extract only bounded, regular generated files; never materialized project sources. */
export async function recoverSandboxArchive(
  input: Readable,
  destination: string,
  sourcePaths: ReadonlySet<string>,
  scratchBytes: number
): Promise<void> {
  const protectedPaths = new Set(sourcePaths)
  for (const source of sourcePaths) {
    let parent = path.posix.dirname(source)
    while (parent !== '.') {
      protectedPaths.add(parent)
      parent = path.posix.dirname(parent)
    }
  }
  let entries = 0
  let files = 0
  let bytes = 0
  let archiveBytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      archiveBytes += chunk.length
      if (archiveBytes > scratchBytes + 32 * 1024 * 1024)
        callback(new Error('Sandbox archive byte limit reached'))
      else callback(null, chunk)
    },
  })
  const unpack = x({
    cwd: destination,
    strict: true,
    preservePaths: false,
    noChmod: true,
    filter(file, entry) {
      if (++entries > MAX_ARCHIVE_ENTRIES) {
        input.destroy(new Error('Sandbox archive entry limit reached'))
        return false
      }
      if (!('type' in entry) || entry.type !== 'File') return false
      if (
        path.posix.isAbsolute(file) ||
        file.includes('\\') ||
        file.split('/').includes('..')
      )
        return false
      const rel = path.posix.normalize(file).replace(/^\.\//, '')
      if (rel === '.' || rel.split('/').length > 64 || protectedPaths.has(rel))
        return false
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) return false
      if (
        files >= MAX_CACHE_FILES ||
        bytes + entry.size > Math.min(scratchBytes, MAX_CACHE_BYTES)
      )
        return false
      files++
      bytes += entry.size
      entry.mode = 0o600
      return true
    },
  })
  await pipeline(input, limiter, unpack)
}
