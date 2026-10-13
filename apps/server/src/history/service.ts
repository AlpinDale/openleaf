import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  classifyContent,
  type HistorySource,
  type HistoryTreeEntry,
  type HistoryVersion,
  isEditableFilename,
  MAX_EDITABLE_FILE_BYTES,
  validateEntryName,
} from '@openleaf/shared'
import { Mutex, Semaphore } from 'async-mutex'
import { eq, inArray } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import git, { type ReadCommitResult } from 'isomorphic-git'
import type * as Y from 'yjs'
import type { AppContext } from '../context.js'
import { historyLabels, projects, projectYdocs, users } from '../db/schema.js'
import { notFound, tooLarge } from '../errors.js'
import { parseHistoryCommit } from '../git/commit-metadata.js'
import { installGitHooks } from '../git/hooks.js'
import { nativeGitCommand } from '../git/native-command.js'
import {
  receiveStateMaxBytes,
  receiveStateSchema,
} from '../git/receive-state.js'
import { assertProjectStateWithinLimit } from '../realtime/admission.js'
import { putBlob, readBlob, releaseBlob } from '../tree/blobs.js'
import { projectLock } from '../tree/locks.js'
import { buildPaths, loadEntries } from '../tree/model.js'
import {
  applyTreeToProjectLocked,
  type ProjectFileContent,
} from '../tree/service.js'
import {
  type ProjectSnapshot,
  projectSnapshotLocked,
} from '../tree/snapshot.js'
import { acquireUntilClosed } from '../util/queue.js'

export type CommitSource = Exclude<HistorySource, 'git'>

export type CommitOptions = {
  source: CommitSource
  authors: string[]
  message?: string
}

type DirtyState = {
  authors: Set<string>
  firstAt: number
  timer: NodeJS.Timeout | null
  /** Bumped on every markDirty; a commit only cleans the state it captured. */
  generation: number
  markerWritten: Promise<void>
}

const MAIN = 'refs/heads/main'
const MARKER = 'openleaf-dirty'
const SYSTEM_AUTHOR = { name: 'OpenLeaf', email: 'system@openleaf.invalid' }
const execGit = promisify(execFile)
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const MAX_COMMIT_BYTES = 64 * 1024

const SUMMARY: Record<CommitSource, string> = {
  create: 'Create project',
  auto: 'Edits',
  restore: 'Restore',
  import: 'Import',
  copy: 'Copy',
}

type GitTreeEntry = {
  mode: string
  path: string
  oid: string
  type: 'blob' | 'tree'
}

/** Git-backed project history (one bare repo per project). */
export class HistoryService {
  private readonly locks = new Map<string, Mutex>()
  private readonly dirty = new Map<string, DirtyState>()
  private readonly garbageCollectors = new Map<
    string,
    { done: Promise<void>; controller: AbortController }
  >()
  private readonly abandonedGarbageAdmissions = new Set<Promise<void>>()
  private readonly nativeGitSlots: Semaphore
  private garbageCollectionClosing = false
  private managedHooksDir: string | null = null
  private readonly activeReceives = new Set<string>()

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
    private readonly timing = { idleMs: 30_000, maxMs: 5 * 60_000 }
  ) {
    this.nativeGitSlots = new Semaphore(ctx.config.maxConcurrentGitOperations)
  }

  get root() {
    return path.join(this.ctx.config.dataDir, 'git')
  }

  get hooksDir() {
    if (!this.managedHooksDir)
      throw new Error('History service has not started')
    return this.managedHooksDir
  }

  gitdir(projectId: string) {
    return path.join(this.root, `${projectId}.git`)
  }

  /** Per-project lock for commits/restores/imports (separate from the tree lock). */
  lock(projectId: string): Mutex {
    let lock = this.locks.get(projectId)
    if (!lock) {
      lock = new Mutex()
      this.locks.set(projectId, lock)
    }
    return lock
  }

  /** Subscribes to edits and recovers projects left dirty by a crash. */
  async start() {
    this.managedHooksDir = await installGitHooks(
      path.join(this.ctx.config.dataDir, 'git-hooks'),
      this.ctx.config.maxUploadBytes,
      this.ctx.config.maxProjectStateBytes
    )
    this.ctx.realtime.events.on('changed', ({ projectId, userId }) =>
      this.markDirty(projectId, userId)
    )
    const names = await fsp.readdir(this.root).catch(err => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return [] as string[]
      throw err
    })
    for (const name of names) {
      const projectId = name.replace(/\.git$/, '')
      if (!name.endsWith('.git')) continue
      const exists = this.ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()
      if (!exists) continue
      await this.ensureRepo(projectId)
      for (const filename of await fsp.readdir(this.gitdir(projectId))) {
        if (/^\.openleaf-receive-state-[0-9a-f-]{36}\.tmp$/.test(filename))
          await fsp.rm(path.join(this.gitdir(projectId), filename), {
            force: true,
          })
      }
      if (fs.existsSync(path.join(this.root, name, MARKER)))
        this.markDirty(projectId, null)
    }
  }

  ensureRepo(projectId: string): Promise<void> {
    return this.lock(projectId).runExclusive(() =>
      this.ensureRepoLocked(projectId)
    )
  }

  private async ensureRepoLocked(projectId: string) {
    if (
      !this.ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()
    ) {
      throw notFound('Project not found')
    }
    const gitdir = this.gitdir(projectId)
    if (!fs.existsSync(path.join(gitdir, 'config')))
      await git.init({ fs, gitdir, bare: true, defaultBranch: 'main' })
    for (const [key, value] of [
      ['core.hooksPath', this.hooksDir],
      ['http.receivepack', 'true'],
      ['receive.denyNonFastForwards', 'true'],
      ['receive.denyDeletes', 'true'],
      ['receive.maxInputSize', '100m'],
      ['core.useReplaceRefs', 'false'],
    ] as const) {
      if ((await git.getConfig({ fs, gitdir, path: key })) !== value)
        await git.setConfig({ fs, gitdir, path: key, value })
    }
    if (!this.activeReceives.has(projectId))
      await this.recoverPendingReceiveLocked(projectId)
  }

  private async recoverPendingReceiveLocked(projectId: string) {
    const file = path.join(
      this.gitdir(projectId),
      'openleaf-receive-state.json'
    )
    let handle: fsp.FileHandle
    try {
      handle = await fsp.open(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
      )
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    let beforeHead: string | null
    let clientId: number
    try {
      const stat = await handle.stat()
      if (
        !stat.isFile() ||
        stat.size > receiveStateMaxBytes(this.ctx.config.maxProjectStateBytes)
      )
        throw tooLarge('Pending Git receive exceeds state limits')
      const bytes = await handle.readFile()
      if (
        bytes.byteLength >
        receiveStateMaxBytes(this.ctx.config.maxProjectStateBytes)
      )
        throw tooLarge('Pending Git receive exceeds state limits')
      const raw = JSON.parse(bytes.toString('utf8'))
      const recordedLimit: unknown = raw?.maxProjectStateBytes
      if (
        typeof recordedLimit !== 'number' ||
        !Number.isSafeInteger(recordedLimit) ||
        recordedLimit <= 0
      )
        throw new Error('Invalid pending Git receive')
      const saved = receiveStateSchema(recordedLimit).parse(raw)
      beforeHead = saved.beforeHead
      clientId = saved.clientId
    } finally {
      await handle.close()
    }
    this.activeReceives.add(projectId)
    try {
      await projectLock(projectId).runExclusive(async () => {
        const head = await this.headOid(projectId)
        if (head !== beforeHead) {
          if (!head) throw notFound('Pending Git receive has no main ref')
          await this.ctx.realtime.withProjectDoc(projectId, async live => {
            live.clientID = clientId
            await this.importPushLocked(projectId, head, beforeHead)
          })
        }
        await fsp.rm(file, { force: true })
      })
    } finally {
      this.activeReceives.delete(projectId)
    }
  }

  private persistProjectState(projectId: string, doc: Y.Doc): Uint8Array {
    const encoded = assertProjectStateWithinLimit(
      doc,
      this.ctx.config.maxProjectStateBytes
    )
    const state = Buffer.from(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength
    )
    this.ctx.db
      .insert(projectYdocs)
      .values({ projectId, state, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: projectYdocs.projectId,
        set: { state, updatedAt: Date.now() },
      })
      .run()
    return encoded
  }

  async headOid(projectId: string): Promise<string | null> {
    try {
      return await git.resolveRef({
        fs,
        gitdir: this.gitdir(projectId),
        ref: MAIN,
      })
    } catch {
      return null
    }
  }

  /** Repo exists and `main` resolves (projects created before history get a first commit). */
  ensureHead(projectId: string): Promise<string> {
    return this.lock(projectId).runExclusive(async () => {
      await this.ensureRepoLocked(projectId)
      const head = await this.headOid(projectId)
      if (head) return head
      await this.commitLocked(projectId, { source: 'create', authors: [] })
      const created = await this.headOid(projectId)
      if (!created)
        throw new Error('Failed to create the initial history commit')
      return created
    })
  }

  isDirty(projectId: string) {
    return this.dirty.has(projectId)
  }

  markDirty(projectId: string, userId: string | null) {
    if (
      !this.ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()
    ) {
      return
    }
    let state = this.dirty.get(projectId)
    if (!state) {
      const gitdir = this.gitdir(projectId)
      state = {
        authors: new Set(),
        firstAt: Date.now(),
        timer: null,
        generation: 0,
        markerWritten: fsp
          .mkdir(gitdir, { recursive: true })
          .then(() => fsp.writeFile(path.join(gitdir, MARKER), ''))
          .catch(err =>
            this.log.error({ err, projectId }, 'failed to write dirty marker')
          ),
      }
      this.dirty.set(projectId, state)
    }
    state.generation++
    if (userId) state.authors.add(userId)
    if (state.timer) clearTimeout(state.timer)
    const wait = Math.max(
      0,
      Math.min(
        this.timing.idleMs,
        state.firstAt + this.timing.maxMs - Date.now()
      )
    )
    state.timer = setTimeout(() => {
      this.flush(projectId).catch(err =>
        this.log.error({ err, projectId }, 'history auto-commit failed')
      )
    }, wait)
    state.timer.unref()
  }

  /** Commits pending edits now (no-op when clean). */
  async flush(projectId: string) {
    if (!this.dirty.has(projectId)) return
    await this.commit(projectId, { source: 'auto', authors: [] })
  }

  async flushAll() {
    for (const projectId of [...this.dirty.keys()]) {
      try {
        await this.flush(projectId)
      } catch (err) {
        this.log.error({ err, projectId }, 'history flush failed')
      }
    }
  }

  /** Forgets dirty state (project deleted). */
  async forget(projectId: string): Promise<void> {
    const state = this.dirty.get(projectId)
    if (state?.timer) clearTimeout(state.timer)
    this.dirty.delete(projectId)
    await state?.markerWritten
  }

  commit(projectId: string, opts: CommitOptions): Promise<string | null> {
    return this.lock(projectId).runExclusive(() =>
      this.commitLocked(projectId, opts)
    )
  }

  /**
   * Snapshot → git commit. Caller holds `lock(projectId)`. With `target`, the
   * commit goes to another ref (with the given parent) and dirty state is kept.
   */
  async commitLocked(
    projectId: string,
    opts: CommitOptions,
    target: { ref: string; parent: string | null } | null = null,
    snapshot?: ProjectSnapshot
  ): Promise<string | null> {
    const project = this.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()
    if (!project) {
      await this.forget(projectId)
      return null
    }
    await this.ensureRepoLocked(projectId)
    const gitdir = this.gitdir(projectId)
    const state = this.dirty.get(projectId)
    const generation = state?.generation
    // Authors accumulated by edits since the last commit join explicit ones.
    const authorIds = [...new Set([...opts.authors, ...(state?.authors ?? [])])]

    const tree = await this.writeSnapshotTree(projectId, snapshot)
    const parent = target ? target.parent : await this.headOid(projectId)
    if (!target && parent) {
      const head = await this.requireCommit(projectId, parent)
      if (head.commit.tree === tree) {
        await this.markClean(projectId, generation)
        return null
      }
    }

    const names = this.userNames(authorIds)
    const first = authorIds[0]
    const author = first
      ? {
          name:
            (names.get(first) ?? 'OpenLeaf user')
              // biome-ignore lint/suspicious/noControlCharactersInRegex: Git identity headers cannot contain control separators.
              .replace(/[<>\x00-\x1f\x7f\u2028\u2029]/g, ' ')
              .trim() || 'OpenLeaf user',
          email: `${first}@users.openleaf.invalid`,
        }
      : SYSTEM_AUTHOR
    const signature = {
      ...author,
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: 0,
    }
    const summary =
      opts.message ??
      (opts.source === 'auto' && authorIds.length
        ? `Edits by ${authorIds.map(id => names.get(id) ?? 'unknown').join(', ')}`
        : SUMMARY[opts.source])
    const message = `${summary}\n\nOpenLeaf-Source: ${opts.source}\nOpenLeaf-Authors: ${authorIds.join(',')}\n`
    const oid = await git.writeCommit({
      fs,
      gitdir,
      commit: {
        message,
        tree,
        parent: parent ? [parent] : [],
        author: signature,
        committer: signature,
      },
    })
    await git.writeRef({
      fs,
      gitdir,
      ref: target?.ref ?? MAIN,
      value: oid,
      force: true,
    })
    if (!target) {
      await this.markClean(projectId, generation)
      this.ctx.realtime.broadcast(projectId, { type: 'history.committed', oid })
    }
    this.collectGarbage(projectId)
    return oid
  }
  private collectGarbage(projectId: string) {
    if (this.garbageCollectionClosing || this.garbageCollectors.has(projectId))
      return
    const controller = new AbortController()
    const done = this.runGarbageCollector(projectId, controller.signal)
    const job = { done, controller }
    this.garbageCollectors.set(projectId, job)
    void done.then(() => {
      if (this.garbageCollectors.get(projectId) === job)
        this.garbageCollectors.delete(projectId)
    })
  }

  private async runGarbageCollector(projectId: string, signal: AbortSignal) {
    let release: (() => void) | undefined
    try {
      release = await acquireUntilClosed(
        this.nativeGitSlots.acquire().then(([, unlock]) => unlock),
        signal,
        ticket => {
          this.abandonedGarbageAdmissions.add(ticket)
          void ticket.then(() => this.abandonedGarbageAdmissions.delete(ticket))
        }
      )
      if (signal.aborted) return
      const command = nativeGitCommand(
        [
          '-c',
          'gc.autoDetach=false',
          '-c',
          'gc.recentObjectsHook=',
          '-c',
          'core.hooksPath=/dev/null',
          'gc',
          '--auto',
          '--quiet',
        ],
        this.ctx.config.gitMemoryBytes
      )
      const gc = spawn(command.file, command.args, {
        cwd: this.gitdir(projectId),
        detached: true,
        stdio: 'ignore',
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_NO_LAZY_FETCH: '1',
          GIT_NO_REPLACE_OBJECTS: '1',
        },
      })
      await new Promise<void>(resolve => {
        const stop = () => {
          if (!gc.pid) return
          try {
            process.kill(-gc.pid, 'SIGKILL')
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ESRCH')
              this.log.warn({ err, projectId }, 'Unable to stop git gc')
          }
        }
        const deadline = setTimeout(stop, 30_000)
        deadline.unref()
        gc.once('error', err => {
          if (!signal.aborted)
            this.log.warn({ err, projectId }, 'git gc failed')
        })
        gc.once('close', (code, exitSignal) => {
          clearTimeout(deadline)
          if (code !== 0 && !signal.aborted)
            this.log.warn(
              { code, signal: exitSignal, projectId },
              'git gc did not complete'
            )
          resolve()
        })
      })
    } catch (err) {
      if (!signal.aborted) this.log.warn({ err, projectId }, 'git gc failed')
    } finally {
      release?.()
    }
  }

  async drainGarbageCollectors(projectId?: string): Promise<void> {
    if (!projectId) this.garbageCollectionClosing = true
    const jobs = projectId
      ? [this.garbageCollectors.get(projectId)].filter(
          (job): job is { done: Promise<void>; controller: AbortController } =>
            job !== undefined
        )
      : [...this.garbageCollectors.values()]
    for (const job of jobs) job.controller.abort()
    await Promise.all(jobs.map(job => job.done))
    if (!projectId) await Promise.all([...this.abandonedGarbageAdmissions])
  }

  /**
   * Clears the dirty state captured at `generation` (undefined: clean before).
   * Edits that arrived during the commit keep the project dirty.
   */
  async markClean(projectId: string, generation: number | undefined) {
    const state = this.dirty.get(projectId)
    if (state && state.generation !== generation) return
    if (state) {
      await state.markerWritten
      if (this.dirty.get(projectId)?.generation !== generation) return
    }
    await fsp.rm(path.join(this.gitdir(projectId), MARKER), { force: true })
    const current = this.dirty.get(projectId)
    if (current && (current !== state || current.generation !== generation)) {
      // An edit can arrive while unlinking the old marker. Keep its crash and
      // pre-receive protection even if the earlier write raced with this unlink.
      await current.markerWritten
      await fsp.writeFile(path.join(this.gitdir(projectId), MARKER), '')
      return
    }
    await this.forget(projectId)
  }

  hasMarker(projectId: string) {
    return fs.existsSync(path.join(this.gitdir(projectId), MARKER))
  }

  private userNames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map()
    return new Map(
      this.ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ids))
        .all()
        .map(u => [u.id, u.name])
    )
  }

  /** Writes blobs and trees for the live project; returns the root tree oid. */
  private async writeSnapshotTree(
    projectId: string,
    snapshot?: ProjectSnapshot
  ): Promise<string> {
    if (!snapshot) {
      return projectLock(projectId).runExclusive(async () =>
        this.writeSnapshotTree(
          projectId,
          await projectSnapshotLocked(this.ctx, projectId)
        )
      )
    }
    await this.ctx.realtime.withProjectDoc(projectId, doc =>
      this.persistProjectState(projectId, doc)
    )
    const gitdir = this.gitdir(projectId)
    type Dir = { files: GitTreeEntry[]; dirs: Map<string, Dir> }
    const root: Dir = { files: [], dirs: new Map() }
    const dirFor = (segments: string[]) => {
      let dir = root
      for (const segment of segments) {
        let child = dir.dirs.get(segment)
        if (!child) {
          child = { files: [], dirs: new Map() }
          dir.dirs.set(segment, child)
        }
        dir = child
      }
      return dir
    }
    for (const entry of snapshot.entries) {
      if (entry.kind === 'folder') continue
      let oid: string
      if (entry.kind === 'doc') {
        oid = await git.writeBlob({
          fs,
          gitdir,
          blob: Buffer.from(entry.text, 'utf8'),
        })
      } else {
        const loose = path.join(
          gitdir,
          'objects',
          entry.gitOid.slice(0, 2),
          entry.gitOid.slice(2)
        )
        oid = fs.existsSync(loose)
          ? entry.gitOid
          : await git.writeBlob({
              fs,
              gitdir,
              blob: await readBlob(this.ctx.config.dataDir, entry.hash),
            })
      }
      const segments = entry.path.split('/')
      const name = segments.pop() as string
      dirFor(segments).files.push({
        mode: '100644',
        path: name,
        oid,
        type: 'blob',
      })
    }
    const write = async (dir: Dir): Promise<string | null> => {
      const items: GitTreeEntry[] = [...dir.files]
      for (const [name, child] of dir.dirs) {
        const oid = await write(child)
        if (oid) items.push({ mode: '040000', path: name, oid, type: 'tree' })
      }
      if (items.length === 0 && dir !== root) return null
      return git.writeTree({ fs, gitdir, tree: items })
    }
    return (await write(root)) as string
  }

  // ---- reading ----

  async listVersions(
    projectId: string,
    { before, limit }: { before?: string; limit: number }
  ): Promise<HistoryVersion[]> {
    await this.ensureHead(projectId)
    await this.flush(projectId)
    const output = await this.gitMetadata(
      projectId,
      ['rev-list', `--max-count=${limit + (before ? 1 : 0)}`, before ?? 'main'],
      16 * 1024
    )
    const commits: Pick<ReadCommitResult, 'oid' | 'commit'>[] = []
    for (const oid of output.toString('ascii').trim().split('\n')) {
      if (!oid || oid === before) continue
      commits.push(await this.requireCommit(projectId, oid))
    }
    const labels = this.ctx.db
      .select({
        id: historyLabels.id,
        name: historyLabels.name,
        commitOid: historyLabels.commitOid,
        createdAt: historyLabels.createdAt,
        userName: users.name,
      })
      .from(historyLabels)
      .leftJoin(users, eq(users.id, historyLabels.userId))
      .where(eq(historyLabels.projectId, projectId))
      .all()
    const trailerAuthors = new Set<string>()
    const parsed = commits.map(c => {
      const info = parseTrailers(c.commit.message)
      for (const id of info.authors) trailerAuthors.add(id)
      return { c, info }
    })
    const names = this.userNames([...trailerAuthors])
    const versions: HistoryVersion[] = []
    for (const { c, info } of parsed) {
      const parentOid = c.commit.parent[0] ?? null
      versions.push({
        oid: c.oid,
        parentOid,
        createdAt: c.commit.committer.timestamp * 1000,
        source: info.source,
        message: info.summary,
        authors:
          info.source === 'git'
            ? [{ id: null, name: c.commit.author.name }]
            : info.authors.map(id => ({
                id,
                name: names.get(id) ?? 'Deleted user',
              })),
        changes: await this.diff(projectId, parentOid, c.oid),
        labels: labels
          .filter(l => l.commitOid === c.oid)
          .map(l => ({
            id: l.id,
            name: l.name,
            userName: l.userName ?? 'Deleted user',
            createdAt: l.createdAt,
          })),
      })
    }
    return versions
  }

  private async gitMetadata(
    projectId: string,
    args: string[],
    maxBuffer: number,
    input?: string
  ): Promise<Buffer> {
    // Foreground metadata bypasses queued maintenance without increasing process concurrency.
    const [, release] = await this.nativeGitSlots.acquire(1, 1)
    try {
      const native = nativeGitCommand(
        ['--git-dir', this.gitdir(projectId), ...args],
        this.ctx.config.gitMemoryBytes
      )
      const command = execGit(native.file, native.args, {
        encoding: 'buffer',
        timeout: 30_000,
        maxBuffer,
        env: {
          PATH: process.env.PATH,
          LC_ALL: 'C',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_NO_LAZY_FETCH: '1',
          GIT_NO_REPLACE_OBJECTS: '1',
        },
      })
      if (input !== undefined) {
        command.child.stdin?.on('error', () => command.child.kill())
        command.child.stdin?.end(input)
      }
      const { stdout } = await command
      return stdout
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        throw tooLarge('Version exceeds project limits')
      if (code === 'ENOENT') throw err
      throw notFound('Version not found')
    } finally {
      release()
    }
  }

  private async diff(projectId: string, parent: string | null, oid: string) {
    const before = parent
      ? await this.versionBlobs(projectId, parent)
      : new Map<string, string>()
    const after = await this.versionBlobs(projectId, oid)
    const changes: HistoryVersion['changes'] = []
    for (const [path, oldOid] of before) {
      const newOid = after.get(path)
      if (!newOid) changes.push({ path, op: 'deleted' })
      else if (newOid !== oldOid) changes.push({ path, op: 'modified' })
    }
    for (const path of after.keys()) {
      if (!before.has(path)) changes.push({ path, op: 'added' })
    }
    changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
    return changes
  }

  private async objectSizes(
    projectId: string,
    oids: string[],
    kind: 'commit' | 'blob'
  ): Promise<Map<string, number>> {
    const sizes = new Map<string, number>()
    if (!oids.length) return sizes
    const requested = new Set(oids)
    if (
      requested.size !== oids.length ||
      oids.some(oid => !/^[0-9a-f]{40}$/.test(oid))
    )
      throw notFound('Invalid git object')
    const output = await this.gitMetadata(
      projectId,
      ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      8 * 1024 * 1024,
      `${oids.join('\n')}\n`
    )
    for (const line of output.toString('ascii').trimEnd().split('\n')) {
      const match = /^([0-9a-f]{40}) (blob|commit|tree|tag) (\d+)$/.exec(line)
      if (!match || match[2] !== kind || !requested.delete(match[1]))
        throw notFound('Version contains invalid object types')
      const size = Number(match[3])
      if (!Number.isSafeInteger(size) || size < 0)
        throw notFound('Invalid git object')
      sizes.set(match[1], size)
    }
    if (requested.size) throw notFound('Invalid git object')
    return sizes
  }

  private async objectSize(
    projectId: string,
    oid: string,
    kind: 'commit' | 'blob'
  ): Promise<number> {
    const size = (await this.objectSizes(projectId, [oid], kind)).get(oid)
    if (size === undefined) throw notFound('Invalid git object')
    return size
  }

  private async requireCommit(
    projectId: string,
    oid: string
  ): Promise<Pick<ReadCommitResult, 'oid' | 'commit'>> {
    if ((await this.objectSize(projectId, oid, 'commit')) > MAX_COMMIT_BYTES)
      throw tooLarge('History commit exceeds project limits')
    const payload = (
      await this.gitMetadata(
        projectId,
        ['cat-file', 'commit', oid],
        MAX_COMMIT_BYTES
      )
    ).toString('utf8')
    try {
      return parseHistoryCommit(oid, payload)
    } catch {
      throw notFound('Invalid commit metadata')
    }
  }

  /** System git inspects trees/sizes before any JS object inflation. */
  private async versionEntries(projectId: string, oid: string) {
    await this.requireCommit(projectId, oid)
    const output = await this.gitMetadata(
      projectId,
      ['ls-tree', '-r', '-l', '-z', '--full-tree', oid],
      8 * 1024 * 1024
    )
    const files = new Map<string, { oid: string; size: number }>()
    const maxBlobBytes = this.ctx.config.maxUploadBytes * 6
    let decoded: string
    try {
      decoded = utf8Decoder.decode(output)
    } catch {
      throw notFound('Version contains invalid file paths')
    }
    for (const record of decoded.split('\0')) {
      if (!record) continue
      const match =
        /^(100644|100755) blob ([0-9a-f]{40}) +(\d+)\t([\s\S]+)$/.exec(record)
      if (!match) throw notFound('Version contains unsupported entries')
      const size = Number(match[3])
      const path = match[4]
      if (path.split('/').some(segment => validateEntryName(segment)))
        throw notFound('Version contains invalid file paths')
      if (!Number.isSafeInteger(size) || size > maxBlobBytes)
        throw tooLarge('History blob exceeds project limits')
      files.set(path, { oid: match[2], size })
    }
    const oids = new Set<string>()
    for (const file of files.values()) oids.add(file.oid)
    const sizes = await this.objectSizes(projectId, [...oids], 'blob')
    for (const file of files.values()) {
      if (sizes.get(file.oid) !== file.size)
        throw notFound('Invalid git object size')
    }
    return files
  }

  /** All blobs of a version: path → oid. */
  async versionBlobs(
    projectId: string,
    oid: string
  ): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    for (const [path, file] of await this.versionEntries(projectId, oid))
      files.set(path, file.oid)
    return files
  }

  async versionTree(
    projectId: string,
    oid: string
  ): Promise<HistoryTreeEntry[]> {
    const out: HistoryTreeEntry[] = []
    const classifications = new Map<string, boolean>()
    for (const [path, file] of await this.versionEntries(projectId, oid)) {
      const editable =
        isEditableFilename(path) && file.size <= MAX_EDITABLE_FILE_BYTES
      let kind: HistoryTreeEntry['kind'] = 'binary'
      if (editable) {
        let text = classifications.get(file.oid)
        if (text === undefined) {
          const { blob } = await git.readBlob({
            fs,
            gitdir: this.gitdir(projectId),
            oid: file.oid,
          })
          text = classifyContent(path, blob) === 'doc'
          classifications.set(file.oid, text)
        }
        if (text) kind = 'text'
      }
      out.push({ path, kind, size: file.size })
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return out
  }

  async readVersionBlob(
    projectId: string,
    blobOid: string
  ): Promise<Uint8Array> {
    if (
      (await this.objectSize(projectId, blobOid, 'blob')) >
      this.ctx.config.maxUploadBytes * 6
    )
      throw tooLarge('History file exceeds project limits')
    const { blob } = await git.readBlob({
      fs,
      gitdir: this.gitdir(projectId),
      oid: blobOid,
    })
    return blob
  }

  async versionFile(
    projectId: string,
    oid: string,
    filepath: string
  ): Promise<Uint8Array> {
    const blobs = await this.versionBlobs(projectId, oid)
    const blobOid = blobs.get(filepath)
    if (!blobOid) throw notFound('File not found in this version')
    return this.readVersionBlob(projectId, blobOid)
  }

  /** Converts blobs from a size-bounded versionEntries tree into live content. */
  private async toProjectFiles(
    projectId: string,
    blobs: Map<string, string>
  ): Promise<Map<string, ProjectFileContent>> {
    const files = new Map<string, ProjectFileContent>()
    const objects = new Map<
      string,
      {
        size: number
        text?: string | null
        binary?: Extract<ProjectFileContent, { kind: 'binary' }>
      }
    >()
    let docBytes = 0
    try {
      for (const [filepath, blobOid] of blobs) {
        let object = objects.get(blobOid)
        let bytes: Uint8Array | undefined
        if (!object) {
          bytes = (
            await git.readBlob({
              fs,
              gitdir: this.gitdir(projectId),
              oid: blobOid,
            })
          ).blob
          object = { size: bytes.byteLength }
          objects.set(blobOid, object)
        }
        if (
          isEditableFilename(filepath) &&
          object.size <= MAX_EDITABLE_FILE_BYTES
        ) {
          if (object.text === undefined) {
            bytes ??= (
              await git.readBlob({
                fs,
                gitdir: this.gitdir(projectId),
                oid: blobOid,
              })
            ).blob
            object.text =
              classifyContent(filepath, bytes) === 'doc'
                ? utf8Decoder.decode(bytes)
                : null
          }
          if (object.text !== null) {
            docBytes += object.size
            if (docBytes > this.ctx.config.maxProjectStateBytes)
              throw tooLarge('Restored documents exceed project state limit')
            files.set(filepath, { kind: 'text', text: object.text })
            continue
          }
        }
        if (!object.binary) {
          bytes ??=
            object.text != null
              ? Buffer.from(object.text, 'utf8')
              : (
                  await git.readBlob({
                    fs,
                    gitdir: this.gitdir(projectId),
                    oid: blobOid,
                  })
                ).blob
          object.binary = Object.assign(
            await putBlob(this.ctx.config.dataDir, bytes),
            { kind: 'binary' as const }
          )
        }
        files.set(filepath, object.binary)
      }
      return files
    } catch (err) {
      await this.releaseProjectFiles(files)
      throw err
    }
  }

  private async releaseProjectFiles(files: Map<string, ProjectFileContent>) {
    for (const file of files.values()) {
      if (file.kind === 'binary')
        await releaseBlob(this.ctx.db, this.ctx.config.dataDir, file)
    }
  }

  async restore(
    projectId: string,
    userId: string,
    oid: string,
    filepath?: string
  ) {
    await this.ensureHead(projectId)
    await this.flush(projectId)
    await this.lock(projectId).runExclusive(async () => {
      const blobs = await this.versionBlobs(projectId, oid)
      if (filepath !== undefined && !blobs.has(filepath)) {
        throw notFound('File not found in this version')
      }
      const selected =
        filepath === undefined
          ? blobs
          : new Map([[filepath, blobs.get(filepath) as string]])
      const files = await this.toProjectFiles(projectId, selected)
      try {
        await projectLock(projectId).runExclusive(async () => {
          if (this.isDirty(projectId)) {
            await this.commitLocked(
              projectId,
              { source: 'auto', authors: [] },
              null,
              await projectSnapshotLocked(this.ctx, projectId)
            )
          }
          await applyTreeToProjectLocked(this.ctx, projectId, files, {
            deleteMissing: filepath === undefined,
          })
          const short = oid.slice(0, 7)
          await this.commitLocked(
            projectId,
            {
              source: 'restore',
              authors: [userId],
              message:
                filepath === undefined
                  ? `Restore to version ${short}`
                  : `Restore ${filepath} from version ${short}`,
            },
            null,
            await projectSnapshotLocked(this.ctx, projectId)
          )
        })
      } finally {
        await this.releaseProjectFiles(files)
      }
    })
  }

  /** Reconciles accepted refs even if the transport fails after `main` changes. */
  async receivePush(
    projectId: string,
    runBackend: () => Promise<void>
  ): Promise<void> {
    await this.lock(projectId).runExclusive(async () => {
      await this.ensureRepoLocked(projectId)
      // Queued websocket edits merge after Git replacement instead of being overwritten.
      await projectLock(projectId).runExclusive(async () => {
        const before = await this.headOid(projectId)
        await this.dirty.get(projectId)?.markerWritten
        this.activeReceives.add(projectId)
        try {
          await this.ctx.realtime.withProjectDoc(projectId, async doc => {
            const rows = loadEntries(this.ctx.db, projectId)
            const paths = buildPaths(rows)
            const docIdsByPath: [string, string][] = []
            for (const entry of rows)
              if (entry.kind === 'doc')
                docIdsByPath.push([paths.get(entry.id) as string, entry.id])
            if (docIdsByPath.length > 10_000)
              throw tooLarge(
                'Project has too many document mappings for Git receive'
              )
            const metadata = JSON.stringify({
              version: 1,
              beforeHead: before,
              clientId: doc.clientID,
              docIdsByPath,
              maxProjectStateBytes: this.ctx.config.maxProjectStateBytes,
            })
            if (Buffer.byteLength(metadata) > 8 * 1024 * 1024)
              throw tooLarge('Project paths exceed Git receive metadata limits')
            const encoded = this.persistProjectState(projectId, doc)
            const state = Buffer.from(
              encoded.buffer,
              encoded.byteOffset,
              encoded.byteLength
            )
            const handoffFile = path.join(
              this.gitdir(projectId),
              'openleaf-receive-state.json'
            )
            const handoffTmp = path.join(
              this.gitdir(projectId),
              `.openleaf-receive-state-${crypto.randomUUID()}.tmp`
            )
            let reconciled = false
            try {
              const handle = await fsp.open(handoffTmp, 'wx', 0o600)
              try {
                await handle.writeFile(`${metadata.slice(0, -1)},"state":"`)
                const chunkBytes = 3 * 64 * 1024
                for (
                  let offset = 0;
                  offset < state.byteLength;
                  offset += chunkBytes
                )
                  await handle.writeFile(
                    state.toString(
                      'base64',
                      offset,
                      Math.min(offset + chunkBytes, state.byteLength)
                    )
                  )
                await handle.writeFile('"}')
                await handle.sync()
              } finally {
                await handle.close()
              }
              await fsp.rename(handoffTmp, handoffFile)
              try {
                await runBackend()
              } finally {
                const after = await this.headOid(projectId)
                if (after && after !== before)
                  await this.importPushLocked(projectId, after, before)
                reconciled = true
              }
            } finally {
              await fsp.rm(handoffTmp, { force: true })
              if (reconciled) await fsp.rm(handoffFile, { force: true })
            }
          })
        } finally {
          this.activeReceives.delete(projectId)
        }
      })
    })
  }

  private async importPushLocked(
    projectId: string,
    oid: string,
    previousHead: string | null
  ) {
    const blobs = await this.versionBlobs(projectId, oid)
    const files = await this.toProjectFiles(projectId, blobs)
    try {
      if (this.isDirty(projectId) || this.hasMarker(projectId)) {
        const ref = `refs/openleaf/preserved/${Date.now()}-${crypto.randomUUID()}`
        const preserved = await this.commitLocked(
          projectId,
          {
            source: 'auto',
            authors: [],
            message: 'Browser edits preserved during a git push',
          },
          { ref, parent: previousHead },
          await projectSnapshotLocked(this.ctx, projectId)
        )
        this.log.warn(
          { projectId, ref, preserved },
          'preserved browser edits overwritten by a git push'
        )
      }
      const generation = this.dirty.get(projectId)?.generation
      await applyTreeToProjectLocked(this.ctx, projectId, files, {
        deleteMissing: true,
      })
      await this.markClean(projectId, generation)
      this.ctx.realtime.broadcast(projectId, { type: 'history.committed', oid })
    } finally {
      await this.releaseProjectFiles(files)
    }
  }
}

/** Reads the OpenLeaf trailers; commits without them came from git pushes. */
export function parseTrailers(message: string): {
  summary: string
  source: HistorySource
  authors: string[]
} {
  const summary = message.split('\n')[0] ?? ''
  const trailers =
    /\n\nOpenLeaf-Source: (create|auto|restore|import|copy)\nOpenLeaf-Authors: ([^\n]*)\n?$/.exec(
      message
    )
  if (!trailers) {
    return { summary, source: 'git', authors: [] }
  }
  return {
    summary,
    source: trailers[1] as HistorySource,
    authors: trailers[2].split(',').filter(Boolean),
  }
}
