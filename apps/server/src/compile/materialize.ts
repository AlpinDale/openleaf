import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../errors.js'
import { blobPath } from '../tree/blobs.js'
import type { ProjectSnapshot } from '../tree/snapshot.js'

/** From Overleaf CLSI DraftModeManager.js. */
export const DRAFT_PREFIX =
  '\\PassOptionsToPackage{draft}{graphicx}\\PassOptionsToPackage{draft}{graphics}'

export type Manifest = Record<string, string>

export type MaterializeResult = {
  written: number
  deleted: number
  rootDocPath: string
  manifest: Manifest
}

export function compileKey(projectId: string, userId: string) {
  return `${projectId}-${userId}`
}

export function compileDir(dataDir: string, key: string) {
  return path.join(dataDir, 'compiles', key)
}

export function manifestPath(dataDir: string, key: string) {
  return path.join(dataDir, 'compiles', `${key}.manifest.json`)
}

/** Resolves a project-relative path, refusing anything that escapes `root`. */
export function safeJoin(root: string, rel: string): string {
  const base = path.resolve(root)
  const full = path.resolve(base, rel)
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Path escapes compile directory: ${rel}`)
  }
  return full
}

/** Generated files are untrusted: sibling containers can leave host-absolute links. */
async function cleanGeneratedPaths(dir: string) {
  let visited = 0
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 64) throw new Error('Compile directory nesting limit reached')
    const entries = await fsp.opendir(folder)
    for await (const entry of entries) {
      if (++visited > 10_000)
        throw new Error(
          'Compile directory entry limit reached; clear the cache'
        )
      const file = path.join(folder, entry.name)
      const stat = await fsp.lstat(file)
      if (stat.isDirectory()) await walk(file, depth + 1)
      else if (!stat.isFile() || stat.nlink > 1)
        await fsp.rm(file, { force: true })
    }
  }
  await walk(dir, 0)
}

export async function readManifest(file: string): Promise<Manifest> {
  try {
    const value: unknown = JSON.parse(await fsp.readFile(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, hash]) => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)
      )
    )
  } catch {
    return {}
  }
}

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Syncs the project snapshot into the per-user compile dir, writing only
 * paths whose content hash changed (or that are missing) and deleting paths
 * that left the project. Generated files (aux, bbl, …) are left in place for
 * incremental latexmk runs.
 */
export async function materialize(
  dataDir: string,
  key: string,
  snapshot: ProjectSnapshot,
  opts: { draft: boolean; rootDocPath: string; maxBytes?: number }
): Promise<MaterializeResult> {
  if (snapshot.entries.length > 10_000)
    throw new HttpError(413, 'too_large', 'Compile input entry limit reached')
  let inputBytes = 0
  for (const entry of snapshot.entries) {
    inputBytes +=
      entry.kind === 'doc'
        ? Buffer.byteLength(entry.text)
        : entry.kind === 'file'
          ? entry.size
          : 0
    if (inputBytes > (opts.maxBytes ?? 1024 * 1024 * 1024))
      throw new HttpError(413, 'too_large', 'Compile input size limit reached')
  }
  const dir = compileDir(dataDir, key)
  const existing = await fsp.lstat(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
    return null
  })
  if (existing && !existing.isDirectory())
    await fsp.rm(dir, { force: true, recursive: true })
  await fsp.mkdir(dir, { recursive: true })
  await cleanGeneratedPaths(dir)
  const manifestFile = manifestPath(dataDir, key)
  const old = await readManifest(manifestFile)
  const next: Manifest = Object.create(null)
  let written = 0
  let deleted = 0
  const paths = new Set(
    snapshot.entries
      .filter(entry => entry.kind !== 'folder')
      .map(entry => entry.path)
  )
  // Remove old sources before creating replacements (a file may become a folder).
  for (const rel of Object.keys(old)) {
    if (paths.has(rel)) continue
    await fsp.rm(safeJoin(dir, rel), { force: true, recursive: true })
    deleted++
  }

  for (const entry of snapshot.entries) {
    if (entry.kind === 'folder') continue
    const dest = safeJoin(dir, entry.path)
    let text: string | null = null
    let hash: string
    if (entry.kind === 'doc') {
      text =
        opts.draft && entry.path === opts.rootDocPath
          ? DRAFT_PREFIX + entry.text
          : entry.text
      hash = sha256(text)
    } else {
      hash = entry.hash
    }
    next[entry.path] = hash
    if (Object.hasOwn(old, entry.path) && old[entry.path] === hash) {
      try {
        const stat = await fsp.lstat(dest)
        if (stat.isFile()) {
          const current = createHash('sha256')
          for await (const chunk of fs.createReadStream(dest))
            current.update(chunk)
          if (current.digest('hex') === hash) continue
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    // Replace rather than overwrite in place so a hardlinked/reflinked
    // previous copy is never modified.
    await fsp.rm(dest, { force: true, recursive: true })
    if (text !== null) {
      await fsp.writeFile(dest, text, 'utf8')
    } else if (entry.kind === 'file') {
      await fsp.copyFile(
        blobPath(dataDir, entry.hash),
        dest,
        fs.constants.COPYFILE_FICLONE
      )
    }
    written++
  }

  await fsp.writeFile(manifestFile, JSON.stringify(next))
  return { written, deleted, rootDocPath: opts.rootDocPath, manifest: next }
}
