import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  type ChktexEntry,
  type CompileOptions,
  type CompileResponse,
  type CompileStatus,
  detectRootDocPath,
  fileExtension,
  type OutputFile,
  type SynctexCodePosition,
  type SynctexPdfPosition,
  type WordCount,
} from '@openleaf/shared'
import { E_ALREADY_LOCKED, Mutex, Semaphore, tryAcquire } from 'async-mutex'
import type { FastifyBaseLogger } from 'fastify'
import type { AppContext } from '../context.js'
import { badRequest, HttpError, notFound } from '../errors.js'
import { projectLock } from '../tree/locks.js'
import {
  type ProjectSnapshot,
  projectSnapshotLocked,
} from '../tree/snapshot.js'
import type { ProjectRow } from '../types.js'
import { acquireUntilClosed } from '../util/queue.js'
import {
  compileDir,
  compileKey,
  type Manifest,
  manifestPath,
  materialize,
  readManifest,
  safeJoin,
} from './materialize.js'
import {
  parseChktexOutput,
  parseSynctexEditOutput,
  parseSynctexViewOutput,
  parseWordcountFromOutput,
} from './parsers.js'
import {
  DockerRunner,
  HostRunner,
  type Runner,
  type RunSpec,
} from './runner.js'

/** From Overleaf CLSI LatexRunner.js. */
const COMPILER_FLAGS: Record<string, string> = {
  latex: '-pdfdvi',
  lualatex: '-lualatex',
  pdflatex: '-pdf',
  xelatex: '-xelatex',
}

const MAX_BUILD_FILES = 500
const MAX_BUILD_BYTES = 1024 * 1024 * 1024
const KEEP_BUILDS = 3
const AUX_TIMEOUT_MS = 30_000
const WORDCOUNT_TIMEOUT_MS = 60_000

class CompileStopped extends Error {}

export const BUILD_ID_RE = /^[0-9a-z]+-[0-9a-f]{8}$/

export function buildsDir(dataDir: string, key: string) {
  return path.join(dataDir, 'builds', key)
}

/** The project's main `.tex` doc, or the detected one when unset/stale. */
export function resolveRootDocPath(
  project: ProjectRow,
  snapshot: ProjectSnapshot
): string | null {
  if (project.rootDocId) {
    const entry = snapshot.entries.find(e => e.id === project.rootDocId)
    if (entry?.kind === 'doc' && fileExtension(entry.path) === 'tex')
      return entry.path
  }
  const docs = new Map<string, string>()
  for (const e of snapshot.entries)
    if (e.kind === 'doc') docs.set(e.path, e.text)
  return detectRootDocPath([...docs.keys()], p => docs.get(p))
}

export type ImageGate = (image: string) => Promise<void>

export class CompileService {
  readonly runner: Runner
  private readonly keyLocks = new Map<string, Mutex>()
  private readonly semaphore: Semaphore
  private readonly preparationSlots: Semaphore
  private readonly shutdown = new AbortController()
  private readonly projectCancellation = new Map<string, AbortController>()
  private closed = false
  private readonly closedProjects = new Set<string>()
  private readonly jobs = new Map<Promise<unknown>, string>()
  private readonly abandonedAdmissions = new Set<Promise<void>>()
  private readonly cancelledKeys = new Set<string>()
  /** Throws when an image can't be used yet (docker runner pulls in the background). */
  imageGate: ImageGate = async () => {}

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
    runner?: Runner
  ) {
    const { config } = ctx
    this.runner =
      runner ??
      (config.compileRunner === 'docker'
        ? new DockerRunner(config)
        : new HostRunner(path.join(config.dataDir, 'cache', 'texmf-var')))
    this.semaphore = new Semaphore(config.maxConcurrentCompiles)
    this.preparationSlots = new Semaphore(config.maxConcurrentCompiles)
  }

  private lock(key: string): Mutex {
    let lock = this.keyLocks.get(key)
    if (!lock) {
      lock = new Mutex()
      this.keyLocks.set(key, lock)
    }
    return lock
  }

  private get dataDir() {
    return this.ctx.config.dataDir
  }
  private withJob<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    if (this.closed || this.closedProjects.has(projectId))
      return Promise.reject(notFound('Project is no longer available'))
    if (
      this.jobs.size + this.abandonedAdmissions.size >=
      Math.max(32, this.ctx.config.maxConcurrentCompiles * 8)
    )
      return Promise.reject(
        new HttpError(429, 'rate_limited', 'Too many queued jobs')
      )
    const job = Promise.resolve().then(fn)
    this.jobs.set(job, projectId)
    void job
      .finally(() => {
        this.jobs.delete(job)
        let pending = false
        for (const id of this.jobs.values())
          if (id === projectId) pending = true
        if (!pending) {
          for (const [key, lock] of this.keyLocks) {
            if (key.startsWith(`${projectId}-`) && !lock.isLocked())
              this.keyLocks.delete(key)
          }
          this.projectCancellation.delete(projectId)
        }
      })
      .catch(() => {})
    return job
  }

  private trackAdmission(ticket: Promise<void>) {
    this.abandonedAdmissions.add(ticket)
    void ticket
      .finally(() => this.abandonedAdmissions.delete(ticket))
      .catch(() => {})
  }

  /** Serialize each caller's cache; acquire runner slots only after prerequisites. */
  private withKeyJob<T>(
    project: ProjectRow,
    userId: string,
    fn: (key: string) => Promise<T>
  ) {
    const key = compileKey(project.id, userId)
    return this.withJob(project.id, () =>
      this.lock(key).runExclusive(async () => {
        await this.imageGate(project.image)
        return fn(key)
      })
    )
  }

  private signal(projectId: string) {
    let controller = this.projectCancellation.get(projectId)
    if (!controller) {
      controller = new AbortController()
      this.projectCancellation.set(projectId, controller)
    }
    if (this.closedProjects.has(projectId)) controller.abort()
    return AbortSignal.any([this.shutdown.signal, controller.signal])
  }

  private async prepare<T>(
    projectId: string,
    fn: (snapshot: ProjectSnapshot) => Promise<T>
  ) {
    const signal = this.signal(projectId)
    if (signal.aborted) throw notFound('Project is no longer available')
    const releaseProject = await acquireUntilClosed(
      projectLock(projectId).acquire(),
      signal,
      ticket => this.trackAdmission(ticket)
    )
    try {
      if (signal.aborted) throw notFound('Project is no longer available')
      const releaseSlot = await acquireUntilClosed(
        this.preparationSlots.acquire().then(([, release]) => release),
        signal,
        ticket => this.trackAdmission(ticket)
      )
      try {
        return await fn(await projectSnapshotLocked(this.ctx, projectId))
      } finally {
        releaseSlot()
      }
    } finally {
      releaseProject()
    }
  }

  private async run(spec: RunSpec) {
    const projectId = spec.key.slice(0, 36)
    const signal = this.signal(projectId)
    if (signal.aborted) throw notFound('Project is no longer available')
    const release = await acquireUntilClosed(
      this.semaphore.acquire().then(([, release]) => release),
      signal,
      ticket => this.trackAdmission(ticket)
    )
    try {
      if (this.closed || this.closedProjects.has(projectId))
        throw notFound('Project is no longer available')
      if (
        this.cancelledKeys.has(spec.key) &&
        (spec.cmd[0] === 'latexmk' || spec.cmd[0] === 'chktex')
      )
        throw new CompileStopped()
      return await this.runner.run(spec)
    } finally {
      release()
    }
  }

  async closeProject(projectId: string) {
    this.closedProjects.add(projectId)
    this.projectCancellation.get(projectId)?.abort()
    await this.runner.killPrefix(`${projectId}-`)
    await Promise.allSettled(
      [...this.jobs].filter(([, id]) => id === projectId).map(([job]) => job)
    )
  }

  async close() {
    this.closed = true
    this.shutdown.abort()
    await this.runner.killPrefix('')
    await Promise.allSettled(this.jobs.keys())
  }

  async compile(
    project: ProjectRow,
    userId: string,
    opts: CompileOptions
  ): Promise<CompileResponse> {
    return this.withJob(project.id, async () => {
      const key = compileKey(project.id, userId)
      let release: () => void
      try {
        release = await tryAcquire(this.lock(key), E_ALREADY_LOCKED).acquire()
      } catch (err) {
        if (err === E_ALREADY_LOCKED) {
          throw new HttpError(
            409,
            'compile_in_progress',
            'A compile is already running'
          )
        }
        throw err
      }
      this.cancelledKeys.delete(key)
      try {
        await this.imageGate(project.image)
        const response = await this.runCompile(project, key, opts)
        this.ctx.realtime.broadcast(project.id, {
          type: 'compile.finished',
          userId,
          buildId: response.buildId,
          status: response.status,
        })
        return response
      } finally {
        release()
        this.cancelledKeys.delete(key)
      }
    })
  }

  private async runCompile(
    project: ProjectRow,
    key: string,
    opts: CompileOptions
  ): Promise<CompileResponse> {
    const started = Date.now()
    const dir = compileDir(this.dataDir, key)
    const response = (
      status: CompileStatus,
      extra: Partial<CompileResponse> = {}
    ): CompileResponse => ({
      status,
      buildId: null,
      rootDocPath: null,
      outputFiles: [],
      chktex: [],
      logPathPrefix: `${this.runner.dirInRunner(dir)}/`,
      durationMs: Date.now() - started,
      ...extra,
    })
    try {
      if (this.cancelledKeys.has(key)) return response('terminated')

      const prepared = await this.prepare(project.id, async snapshot => {
        const rootDocPath = resolveRootDocPath(project, snapshot)
        if (!rootDocPath) return null
        const result = await materialize(this.dataDir, key, snapshot, {
          draft: opts.draft,
          rootDocPath,
          maxBytes: this.ctx.config.compileScratchMb * 1024 * 1024,
        })
        return { ...result, rootDocPath }
      })
      if (!prepared) return response('no-root-doc')
      const { manifest, rootDocPath } = prepared
      const sourcePaths = new Set(Object.keys(manifest))
      if (this.cancelledKeys.has(key))
        return response('terminated', { rootDocPath })

      // Never accept project sources as generated output, or keep stale SyncTeX.
      if (
        Object.hasOwn(manifest, 'output.pdf') ||
        Object.hasOwn(manifest, 'output.synctex.gz')
      )
        throw badRequest(
          'Project source names output.pdf and output.synctex.gz are reserved'
        )
      await fsp.rm(path.join(dir, 'output.pdf'), {
        force: true,
        recursive: true,
      })
      await fsp.rm(path.join(dir, 'output.synctex.gz'), {
        force: true,
        recursive: true,
      })
      if (this.cancelledKeys.has(key))
        return response('terminated', { rootDocPath })
      let chktex: ChktexEntry[] = []
      if (opts.syntaxCheck) {
        const result = await this.run({
          key,
          sourcePaths,
          dir,
          image: project.image,
          timeoutMs: AUX_TIMEOUT_MS,
          cmd: [
            'chktex',
            '-q',
            '-v0',
            '-I1',
            // Overleaf's selection: only environment mismatches are errors.
            '-nall',
            '-e9',
            '-e10',
            '-w15',
            '-w16',
            '-f',
            '%f:%l:%c:%k:%n:%m\n',
            `${this.runner.dirInRunner(dir)}/${rootDocPath}`,
          ],
        })
        chktex = parseChktexOutput(result.stdout)
        if (result.timedOut)
          return response('timedout', { rootDocPath, chktex })
        if (result.killed)
          return response('terminated', { rootDocPath, chktex })
        if (chktex.some(e => e.kind === 'Error')) {
          return response('validation-problems', { rootDocPath, chktex })
        }
      }

      const compilerFlag =
        COMPILER_FLAGS[project.compiler] ?? COMPILER_FLAGS.pdflatex
      const isDocker = this.ctx.config.compileRunner === 'docker'
      const runLatexmk = (force: boolean) =>
        this.run({
          key,
          sourcePaths,
          dir,
          image: project.image,
          timeoutMs: this.ctx.config.compileTimeoutMs,
          cmd: [
            'latexmk',
            // The host runner isn't sandboxed: never execute project latexmkrc files there.
            ...(isDocker ? [] : ['-norc']),
            ...(force ? ['-g'] : []),
            '-cd',
            '-jobname=output',
            `-auxdir=${this.runner.dirInRunner(dir)}`,
            `-outdir=${this.runner.dirInRunner(dir)}`,
            '-synctex=1',
            '-interaction=batchmode',
            '-time',
            opts.stopOnFirstError ? '-halt-on-error' : '-f',
            compilerFlag,
            ...(isDocker ? ['-shell-escape'] : ['-no-shell-escape']),
            `${this.runner.dirInRunner(dir)}/${rootDocPath}`,
          ],
        })
      let result = await runLatexmk(false)
      // After a run with errors, latexmk won't rerun an unchanged project even
      // though output.pdf was deleted ("gave an error in previous invocation");
      // only then force a full pass, so normal compiles stay incremental.
      if (
        !result.timedOut &&
        !result.killed &&
        !fs.existsSync(path.join(dir, 'output.pdf')) &&
        /gave an error in previous invocation/.test(
          result.stdout + result.stderr
        )
      ) {
        result = await runLatexmk(true)
      }

      let status: CompileStatus
      if (result.timedOut) status = 'timedout'
      else if (result.killed) status = 'terminated'
      else if (
        (
          await fsp.lstat(path.join(dir, 'output.pdf')).catch(() => null)
        )?.isFile()
      )
        status = 'success'
      else status = 'failure'

      const buildId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
      const outputFiles = await this.collectBuild(
        project.id,
        key,
        buildId,
        manifest,
        started
      )
      return response(status, { buildId, rootDocPath, outputFiles, chktex })
    } catch (err) {
      if (err instanceof CompileStopped) return response('terminated')
      throw err
    }
  }

  /** Copies fresh generated files into builds/<key>/<buildId>/ and prunes old builds. */
  private async collectBuild(
    projectId: string,
    key: string,
    buildId: string,
    manifest: Manifest,
    since: number
  ): Promise<OutputFile[]> {
    const dir = compileDir(this.dataDir, key)
    const keyBuilds = buildsDir(this.dataDir, key)
    const target = path.join(keyBuilds, buildId)
    await fsp.mkdir(target, { recursive: true })
    const files: OutputFile[] = []
    let total = 0
    let visited = 0
    let skipped = 0
    const walk = async (rel: string, depth = 0): Promise<void> => {
      if (depth > 64) {
        skipped++
        return
      }
      const items = await fsp.opendir(path.join(dir, rel))
      for await (const item of items) {
        if (++visited > 10_000) {
          skipped++
          break
        }
        const relPath = rel ? `${rel}/${item.name}` : item.name
        if (item.isDirectory()) {
          if (!item.name.startsWith('.')) await walk(relPath, depth + 1)
          continue
        }
        if (!item.isFile() || Object.hasOwn(manifest, relPath)) continue
        const stat = await fsp.lstat(path.join(dir, relPath))
        if (!stat.isFile() || stat.nlink > 1) continue
        if (stat.mtimeMs < since) continue
        if (
          files.length >= MAX_BUILD_FILES ||
          total + stat.size > MAX_BUILD_BYTES
        ) {
          skipped++
          continue
        }
        const dest = path.join(target, relPath)
        await fsp.mkdir(path.dirname(dest), { recursive: true })
        await fsp.copyFile(
          path.join(dir, relPath),
          dest,
          fs.constants.COPYFILE_FICLONE
        )
        total += stat.size
        files.push({
          path: relPath,
          url: `/api/projects/${projectId}/builds/${buildId}/files/${relPath
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`,
          size: stat.size,
          type: fileExtension(relPath),
        })
      }
    }
    await walk('')
    if (skipped > 0)
      this.log.warn({ key, buildId, skipped }, 'build output limit reached')
    const builds = (await fsp.readdir(keyBuilds))
      .filter(n => BUILD_ID_RE.test(n))
      .sort()
    for (const old of builds.slice(
      0,
      Math.max(0, builds.length - KEEP_BUILDS)
    )) {
      await fsp.rm(path.join(keyBuilds, old), { recursive: true, force: true })
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return files
  }

  async stop(projectId: string, userId: string) {
    const key = compileKey(projectId, userId)
    if (this.keyLocks.get(key)?.isLocked()) this.cancelledKeys.add(key)
    await this.runner.kill(compileKey(projectId, userId))
  }

  async clearCache(projectId: string, userId: string) {
    const key = compileKey(projectId, userId)
    return this.withJob(projectId, async () => {
      await this.lock(key).runExclusive(async () => {
        await fsp.rm(compileDir(this.dataDir, key), {
          recursive: true,
          force: true,
        })
        await fsp.rm(manifestPath(this.dataDir, key), { force: true })
        await fsp.rm(buildsDir(this.dataDir, key), {
          recursive: true,
          force: true,
        })
      })
    })
  }

  private async requireSynctex(key: string) {
    const dir = compileDir(this.dataDir, key)
    const synctex = await fsp
      .lstat(path.join(dir, 'output.synctex.gz'))
      .catch(() => null)
    const pdf = await fsp.lstat(path.join(dir, 'output.pdf')).catch(() => null)
    if (!synctex?.isFile() || !pdf?.isFile()) {
      throw notFound('No SyncTeX data; compile the project first')
    }
    const manifest = await readManifest(manifestPath(this.dataDir, key))
    return { dir, sourcePaths: new Set(Object.keys(manifest)) }
  }

  async synctexFromCode(
    project: ProjectRow,
    userId: string,
    input: { path: string; line: number; column: number }
  ): Promise<SynctexPdfPosition[]> {
    return this.withKeyJob(project, userId, async key => {
      const { dir, sourcePaths } = await this.requireSynctex(key)
      await this.prepare(project.id, async rows => {
        if (!rows.entries.some(e => e.kind === 'doc' && e.path === input.path))
          throw notFound('Document not found')
      })
      safeJoin(dir, input.path)
      const result = await this.run({
        key: `${key}-synctex`,
        dir,
        sourcePaths,
        image: project.image,
        timeoutMs: AUX_TIMEOUT_MS,
        cmd: [
          'synctex',
          'view',
          '-i',
          `${input.line}:${input.column}:${this.runner.dirInRunner(dir)}/${input.path}`,
          '-o',
          `${this.runner.dirInRunner(dir)}/output.pdf`,
        ],
      })
      return parseSynctexViewOutput(result.stdout)
    })
  }

  async synctexFromPdf(
    project: ProjectRow,
    userId: string,
    input: { page: number; h: number; v: number },
    docPaths: Set<string>
  ): Promise<SynctexCodePosition[]> {
    return this.withKeyJob(project, userId, async key => {
      const { dir, sourcePaths } = await this.requireSynctex(key)
      const result = await this.run({
        key: `${key}-synctex`,
        dir,
        sourcePaths,
        image: project.image,
        timeoutMs: AUX_TIMEOUT_MS,
        cmd: [
          'synctex',
          'edit',
          '-o',
          `${input.page}:${input.h}:${input.v}:${this.runner.dirInRunner(dir)}/output.pdf`,
        ],
      })
      // TeX records real paths (e.g. /private/var/… on macOS for /var/…).
      const runnerDir = this.runner.dirInRunner(dir)
      const prefixes = [`${runnerDir}/`]
      if (runnerDir === dir) prefixes.push(`${fs.realpathSync(dir)}/`)
      const out: SynctexCodePosition[] = []
      for (const record of parseSynctexEditOutput(result.stdout)) {
        let file = record.file
        const prefix = prefixes.find(p => file.startsWith(p))
        if (prefix) file = file.slice(prefix.length)
        file = path.posix.normalize(file).replace(/^(\.\/)+/, '')
        if (!docPaths.has(file)) continue
        out.push({ path: file, line: record.line, column: record.column ?? -1 })
      }
      return out
    })
  }

  async wordcount(
    project: ProjectRow,
    userId: string,
    docId?: string
  ): Promise<WordCount> {
    return this.withKeyJob(project, userId, async key => {
      const { docPath, sourcePaths } = await this.prepare(
        project.id,
        async snapshot => {
          const rootDocPath = resolveRootDocPath(project, snapshot)
          let docPath = rootDocPath
          if (docId) {
            const entry = snapshot.entries.find(e => e.id === docId)
            if (entry?.kind !== 'doc') throw notFound('Document not found')
            docPath = entry.path
          }
          if (!docPath) throw badRequest('No main document found')
          const { manifest } = await materialize(this.dataDir, key, snapshot, {
            draft: false,
            rootDocPath: rootDocPath ?? docPath,
            maxBytes: this.ctx.config.compileScratchMb * 1024 * 1024,
          })
          return { docPath, sourcePaths: new Set(Object.keys(manifest)) }
        }
      )
      const result = await this.run({
        key,
        sourcePaths,
        dir: compileDir(this.dataDir, key),
        image: project.image,
        timeoutMs: WORDCOUNT_TIMEOUT_MS,
        cmd: [
          'texcount',
          '-nocol',
          '-inc',
          `${this.runner.dirInRunner(compileDir(this.dataDir, key))}/${docPath}`,
        ],
      })
      return parseWordcountFromOutput(result.stdout)
    })
  }
}
