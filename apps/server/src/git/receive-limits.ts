import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  classifyContent,
  isEditableFilename,
  MAX_EDITABLE_FILE_BYTES,
  validateEntryName,
} from '@openleaf/shared'
import * as Y from 'yjs'
import { HttpError } from '../errors.js'
import { assertProjectStateWithinLimit } from '../realtime/admission.js'
import { assertMaterializablePath } from '../tree/paths.js'
import { type ProjectedFile, projectYState } from '../tree/projected-state.js'
import { parseHistoryCommit } from './commit-metadata.js'
import { nativeGitCommand } from './native-command.js'
import { receiveStateMaxBytes, receiveStateSchema } from './receive-state.js'

// Runs in the receive-pack quarantine, before any proposed ref is accepted.
// Metadata bounds objects before any editable blob is decoded.
const MAX_FILES = 2000
const MAX_OBJECTS = MAX_FILES * 5
const MAX_TREE_BYTES = MAX_FILES * 512
const MAX_COMMIT_BYTES = 64 * 1024
const MAX_METADATA_BYTES = 8 * 1024 * 1024

const maxBlobBytes = Number(process.argv[2])
const newOid = process.argv[3]
const maxProjectStateBytes = Number(process.argv[4])
const memoryLimit = process.env.OPENLEAF_GIT_PROCESS_MEMORY_BYTES
const gitMemoryBytes = memoryLimit === undefined ? 0 : Number(memoryLimit)
if (
  !Number.isSafeInteger(maxBlobBytes) ||
  maxBlobBytes < 1 ||
  maxBlobBytes > Number.MAX_SAFE_INTEGER / 6 ||
  !Number.isSafeInteger(maxProjectStateBytes) ||
  maxProjectStateBytes < 1 ||
  maxProjectStateBytes > 2 * 1024 * 1024 * 1024 ||
  (memoryLimit !== undefined &&
    (!Number.isSafeInteger(gitMemoryBytes) ||
      gitMemoryBytes < 128 * 1024 * 1024 ||
      gitMemoryBytes > 4096 * 1024 * 1024)) ||
  !newOid ||
  !/^[a-f0-9]{40}$/.test(newOid)
) {
  console.error('OpenLeaf: invalid receive validation arguments')
  process.exit(1)
}
const maxExpandedBytes = maxBlobBytes * 6
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
}

function metadata(
  args: string[],
  gitEnv: NodeJS.ProcessEnv = env,
  input?: string
): string {
  try {
    const command = nativeGitCommand(args, gitMemoryBytes)
    const bytes = execFileSync(command.file, command.args, {
      env: gitEnv,
      input,
      maxBuffer: MAX_METADATA_BYTES,
      timeout: 10_000,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Git metadata is invalid or exceeds resource limits')
  }
}

async function readObjectBatch(
  objects: ReadonlyMap<string, { type: 'commit' | 'blob'; maxSize: number }>,
  consume: (oid: string, content: Buffer) => void
) {
  if (!objects.size) return
  const command = nativeGitCommand(['cat-file', '--batch'], gitMemoryBytes)
  const child = spawn(command.file, command.args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const exited = new Promise<number | null>(resolve => {
    child.once('error', () => resolve(null))
    child.once('close', code => resolve(code))
  })
  child.stderr.resume()
  let inputFailed = false
  child.stdin.on('error', () => {
    inputFailed = true
    child.kill('SIGKILL')
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
  timer.unref()
  child.stdin.end(`${[...objects.keys()].join('\n')}\n`)
  const expected = objects.keys()
  let headerBytes: Buffer = Buffer.alloc(0)
  let record: {
    oid: string
    size: number
    content: Buffer
    received: number
  } | null = null
  let count = 0
  let outputBytes = 0
  let complete = false
  try {
    for await (const chunk of child.stdout) {
      outputBytes += chunk.length
      if (outputBytes > maxExpandedBytes + MAX_COMMIT_BYTES + MAX_OBJECTS * 96)
        throw new Error('Git object data exceeds resource limits')
      let cursor = 0
      while (cursor < chunk.length) {
        if (!record) {
          const newline = chunk.indexOf(10, cursor)
          const end = newline < 0 ? chunk.length : newline
          if (headerBytes.length + end - cursor > 96)
            throw new Error('invalid Git object header')
          const fragment = chunk.subarray(cursor, end)
          const header = headerBytes.length
            ? Buffer.concat([headerBytes, fragment])
            : fragment
          if (newline < 0) {
            headerBytes = header
            break
          }
          headerBytes = Buffer.alloc(0)
          const match = /^([a-f0-9]{40}) (commit|blob) ([0-9]+)$/.exec(
            header.toString('ascii')
          )
          const spec = match && objects.get(match[1])
          const size = match ? Number(match[3]) : NaN
          if (
            !match ||
            !spec ||
            match[1] !== expected.next().value ||
            match[2] !== spec.type ||
            !Number.isSafeInteger(size) ||
            size > spec.maxSize
          )
            throw new Error('invalid Git object header')
          cursor = newline + 1
          if (size <= chunk.length - cursor) {
            record = {
              oid: match[1],
              size,
              content: chunk.subarray(cursor, cursor + size),
              received: size,
            }
            cursor += size
          } else {
            record = {
              oid: match[1],
              size,
              content: Buffer.allocUnsafe(size),
              received: 0,
            }
          }
        }
        const length = Math.min(
          record.size - record.received,
          chunk.length - cursor
        )
        if (length) {
          chunk.copy(record.content, record.received, cursor, cursor + length)
          record.received += length
          cursor += length
        }
        if (record.received !== record.size || cursor === chunk.length) break
        if (chunk[cursor++] !== 10)
          throw new Error('invalid Git object framing')
        consume(record.oid, record.content)
        record = null
        count++
      }
    }
    if (
      inputFailed ||
      record ||
      headerBytes.length ||
      count !== objects.size ||
      (await exited) !== 0
    )
      throw new Error('Git object data is invalid or exceeds resource limits')
    complete = true
  } finally {
    clearTimeout(timer)
    if (!complete) child.kill('SIGKILL')
    await exited
  }
}

function inspectObjects(rows: string) {
  let count = 0
  let expandedBytes = 0
  const commits = new Set<string>()
  for (const row of rows.split('\n')) {
    if (!row) continue
    const match = /^([a-f0-9]{40}) (blob|tree|commit|tag) ([0-9]+)$/.exec(row)
    if (!match) throw new Error('invalid object metadata')
    const type = match[2]
    const size = Number(match[3])
    if (!Number.isSafeInteger(size)) throw new Error('invalid object size')
    const limit =
      type === 'blob'
        ? maxBlobBytes
        : type === 'tree'
          ? MAX_TREE_BYTES
          : MAX_COMMIT_BYTES
    if (size > limit) throw new Error(`${type} exceeds decoded size limit`)
    if (++count > MAX_OBJECTS) throw new Error('too many incoming objects')
    expandedBytes += size
    if (expandedBytes > maxExpandedBytes)
      throw new Error('incoming objects exceed decoded total size limit')
    if (type === 'commit') commits.add(match[1])
  }
  return commits
}

async function validateProjectedState(
  tip: ReadonlyMap<string, { oid: string; size: number }>
) {
  const file = path.join(
    process.env.GIT_DIR ?? '.',
    'openleaf-receive-state.json'
  )
  const stat = fs.lstatSync(file)
  const maxSnapshotBytes = receiveStateMaxBytes(maxProjectStateBytes)
  if (!stat.isFile() || stat.size > maxSnapshotBytes) {
    throw new Error('project state handoff exceeds resource limits')
  }
  const schema = receiveStateSchema(maxProjectStateBytes)
  const result = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!result.success) throw new Error('invalid project state handoff')
  const bytes = Buffer.from(result.data.state, 'base64')
  if (bytes.byteLength > maxProjectStateBytes)
    throw new Error('project state exceeds size limit')
  const current = new Y.Doc()
  let projected: Y.Doc | null = null
  try {
    Y.applyUpdate(current, bytes)
    current.clientID = result.data.clientId
    assertProjectStateWithinLimit(current, maxProjectStateBytes)
    const files = new Map<string, ProjectedFile>()
    const pathsByOid = new Map<string, string[]>()
    const objects = new Map<string, { type: 'blob'; maxSize: number }>()
    for (const [name, { oid, size }] of tip) {
      if (!isEditableFilename(name) || size > MAX_EDITABLE_FILE_BYTES) {
        files.set(name, { kind: 'file' })
        continue
      }
      const names = pathsByOid.get(oid)
      if (names) names.push(name)
      else pathsByOid.set(oid, [name])
      objects.set(oid, { type: 'blob', maxSize: MAX_EDITABLE_FILE_BYTES })
    }
    let incomingTextBytes = 0
    await readObjectBatch(objects, (oid, content) => {
      const names = pathsByOid.get(oid) as string[]
      const isDoc = classifyContent(names[0], content) === 'doc'
      if (isDoc) {
        incomingTextBytes += content.byteLength * names.length
        if (incomingTextBytes > maxProjectStateBytes)
          throw new Error('project state exceeds configured quota')
      }
      const text = isDoc ? content.toString('utf8') : ''
      for (const name of names)
        files.set(name, isDoc ? { kind: 'doc', text } : { kind: 'file' })
    })
    projected = projectYState(
      current,
      new Map(result.data.docIdsByPath),
      files,
      true
    )
    assertProjectStateWithinLimit(projected ?? current, maxProjectStateBytes)
  } finally {
    projected?.destroy()
    current.destroy()
  }
}

try {
  const quarantine = process.env.GIT_QUARANTINE_PATH
  if (!quarantine) throw new Error('receive quarantine is required')
  // Exclude alternates so the metadata budget counts new objects, not the
  // entire existing history. This check happens BEFORE traversing new trees.
  const incomingEnv: NodeJS.ProcessEnv = {
    ...env,
    GIT_OBJECT_DIRECTORY: quarantine,
  }
  delete incomingEnv.GIT_ALTERNATE_OBJECT_DIRECTORIES
  const commits = inspectObjects(
    metadata(
      [
        'cat-file',
        '--batch-all-objects',
        '--batch-check=%(objectname) %(objecttype) %(objectsize)',
      ],
      incomingEnv
    )
  )
  if (!commits.has(newOid)) {
    const header = metadata(
      ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      env,
      `${newOid}\n`
    ).trim()
    const match = /^[a-f0-9]{40} commit ([0-9]+)$/.exec(header)
    if (!match || Number(match[1]) > MAX_COMMIT_BYTES)
      throw new Error('invalid or oversized proposed commit')
    commits.add(newOid)
  }
  await readObjectBatch(
    new Map(
      Array.from(commits, oid => [
        oid,
        { type: 'commit' as const, maxSize: MAX_COMMIT_BYTES },
      ])
    ),
    (oid, content) => {
      parseHistoryCommit(oid, content.toString('utf8'))
    }
  )

  // Also bound every current file, including blobs reused from old history.
  const rows = metadata(['ls-tree', '-rlz', '--full-tree', newOid])
  let count = 0
  let expandedBytes = 0
  const tip = new Map<string, { oid: string; size: number }>()
  const dataDir = path.dirname(
    path.dirname(path.resolve(process.env.GIT_DIR ?? '.'))
  )
  const directories = new Set<string>()
  for (const row of rows.split('\0')) {
    if (!row) continue
    const match =
      /^(100644|100755) blob ([a-f0-9]{40})\s+([0-9]+)\t([\s\S]+)$/.exec(row)
    if (!match) throw new Error('only regular files can be pushed')
    if (match[4].split('/').some(segment => validateEntryName(segment))) {
      throw new Error('project contains an invalid filename')
    }
    assertMaterializablePath(dataDir, match[4])
    const size = Number(match[3])
    if (!Number.isSafeInteger(size) || size > maxBlobBytes)
      throw new Error('file exceeds decoded size limit')
    if (++count > MAX_FILES) throw new Error('too many project files')
    expandedBytes += size
    if (expandedBytes > maxExpandedBytes)
      throw new Error('project exceeds decoded total size limit')
    if (tip.has(match[4]) || directories.has(match[4])) {
      throw new Error('project contains conflicting paths')
    }
    let parent = path.posix.dirname(match[4])
    while (parent !== '.' && !directories.has(parent)) {
      if (tip.has(parent)) throw new Error('project contains conflicting paths')
      directories.add(parent)
      if (count + directories.size > MAX_FILES)
        throw new Error('too many project entries')
      parent = path.posix.dirname(parent)
    }
    if (count + directories.size > MAX_FILES)
      throw new Error('too many project entries')
    tip.set(match[4], { oid: match[2], size })
  }
  if (tip.size) {
    const oids = [...new Set(Array.from(tip.values(), file => file.oid))]
    const types = metadata(
      ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      env,
      `${oids.join('\n')}\n`
    )
    const records = types.trimEnd().split('\n')
    if (
      records.length !== oids.length ||
      records.some(row => !/^[a-f0-9]{40} blob [0-9]+$/.test(row))
    ) {
      throw new Error('project contains a non-blob file object')
    }
  }
  await validateProjectedState(tip)
} catch (error) {
  let message = 'Git objects or project state could not be validated'
  if (error instanceof HttpError) {
    message =
      error.code === 'too_large'
        ? 'project state exceeds configured quota'
        : error.message
  } else if (
    error instanceof Error &&
    !('code' in error) &&
    !('status' in error) &&
    !(error instanceof SyntaxError)
  ) {
    message = error.message
  }
  // Do not reflect stderr or attacker-controlled filenames/object contents.
  console.error(
    `OpenLeaf: push rejected by project limits (${message.slice(0, 200)})`
  )
  process.exit(1)
}
