import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type ExportFormat, fileExtension } from '@openleaf/shared'
import { Semaphore } from 'async-mutex'
import type { FastifyBaseLogger } from 'fastify'
import { safeJoin } from '../compile/materialize.js'
import { resolveRootDocPath } from '../compile/service.js'
import type { AppContext } from '../context.js'
import { badRequest, HttpError } from '../errors.js'
import { blobPath } from '../tree/blobs.js'
import { projectLock } from '../tree/locks.js'
import { projectSnapshotLocked } from '../tree/snapshot.js'
import type { ProjectRow } from '../types.js'
import { acquireUntilClosed } from '../util/queue.js'
import { flattenLatex } from './flatten.js'
import {
  PandocMissingError,
  PandocOutputLimitError,
  type PandocResult,
  probePandoc,
  runPandoc,
} from './pandoc.js'
import { sanitizeAst } from './sanitize-ast.js'

const TIMEOUT_MS = 120_000

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

const converterUnavailable = () =>
  new HttpError(
    503,
    'converter_unavailable',
    'Document export is unavailable: pandoc is not installed on the server'
  )

export class ExportService {
  private readonly semaphore: Semaphore
  private readonly preparationSlots: Semaphore
  private closed = false
  private readonly closedProjects = new Set<string>()
  private readonly jobs = new Map<
    Promise<unknown>,
    { projectId: string; controller: AbortController }
  >()
  private readonly abandonedAdmissions = new Set<Promise<void>>()

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger
  ) {
    this.semaphore = new Semaphore(ctx.config.maxConcurrentCompiles)
    this.preparationSlots = new Semaphore(ctx.config.maxConcurrentCompiles)
  }

  async available(): Promise<boolean> {
    return (
      !this.closed && (await probePandoc(this.ctx.config.pandocPath)) !== null
    )
  }

  async closeProject(projectId: string) {
    this.closedProjects.add(projectId)
    const jobs = [...this.jobs].filter(([, job]) => job.projectId === projectId)
    for (const [, job] of jobs) job.controller.abort()
    await Promise.allSettled(jobs.map(([promise]) => promise))
  }

  async close() {
    this.closed = true
    for (const job of this.jobs.values()) job.controller.abort()
    await Promise.allSettled(this.jobs.keys())
  }

  private trackAdmission(ticket: Promise<void>) {
    this.abandonedAdmissions.add(ticket)
    void ticket
      .finally(() => this.abandonedAdmissions.delete(ticket))
      .catch(() => {})
  }

  /** Sandbox the reader; writers only receive sanitized AST and project-owned assets. */
  export(project: ProjectRow, format: ExportFormat): Promise<Buffer> {
    if (this.closed || this.closedProjects.has(project.id))
      return Promise.reject(
        new HttpError(404, 'not_found', 'Project is no longer available')
      )
    if (
      this.jobs.size + this.abandonedAdmissions.size >=
      Math.max(32, this.ctx.config.maxConcurrentCompiles * 8)
    )
      return Promise.reject(
        new HttpError(429, 'rate_limited', 'Too many queued exports')
      )
    const controller = new AbortController()
    const signal = controller.signal
    const job = Promise.resolve().then(async () => {
      signal.throwIfAborted()
      const pandoc = await probePandoc(this.ctx.config.pandocPath)
      if (!pandoc) throw converterUnavailable()
      signal.throwIfAborted()
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'openleaf-export-'))
      try {
        const projectDir = path.join(tmp, 'project')
        await fsp.mkdir(projectDir)
        signal.throwIfAborted()
        const releaseProject = await acquireUntilClosed(
          projectLock(project.id).acquire(),
          signal,
          ticket => this.trackAdmission(ticket)
        )
        const prepared = await (async () => {
          let releasePreparation: (() => void) | undefined
          try {
            signal.throwIfAborted()
            releasePreparation = await acquireUntilClosed(
              this.preparationSlots.acquire().then(([, release]) => release),
              signal,
              ticket => this.trackAdmission(ticket)
            )
            signal.throwIfAborted()
            const snapshot = await projectSnapshotLocked(this.ctx, project.id)
            let bytes = 0
            if (snapshot.entries.length > 2000)
              throw new HttpError(413, 'too_large', 'Export has too many files')
            for (const entry of snapshot.entries) {
              signal.throwIfAborted()
              const dest = safeJoin(projectDir, entry.path)
              if (entry.kind === 'folder') {
                await fsp.mkdir(dest, { recursive: true })
                continue
              }
              bytes +=
                entry.kind === 'doc'
                  ? Buffer.byteLength(entry.text)
                  : entry.size
              if (bytes > this.ctx.config.maxUploadBytes * 6)
                throw new HttpError(
                  413,
                  'too_large',
                  'Export project size limit reached'
                )
              await fsp.mkdir(path.dirname(dest), { recursive: true })
              if (entry.kind === 'doc') await fsp.writeFile(dest, entry.text)
              else
                await fsp.copyFile(
                  blobPath(this.ctx.config.dataDir, entry.hash),
                  dest,
                  fs.constants.COPYFILE_FICLONE
                )
            }
            const rootDocPath = resolveRootDocPath(project, snapshot)
            if (!rootDocPath) throw badRequest('No main document to export')
            const docs = new Map<string, string>()
            const projectFiles = new Set<string>()
            for (const entry of snapshot.entries) {
              if (entry.kind === 'doc') docs.set(entry.path, entry.text)
              if (entry.kind !== 'folder') projectFiles.add(entry.path)
            }
            const mainBib = snapshot.entries.find(
              e => e.id === project.mainBibDocId && e.kind === 'doc'
            )
            const bibPaths = mainBib
              ? [mainBib.path]
              : [...docs.keys()].filter(p => fileExtension(p) === 'bib')
            const rootDir = path.posix.dirname(rootDocPath)
            const cwd = safeJoin(projectDir, rootDir)
            const source = flattenLatex(rootDocPath, docs)
            const astArgs = ['--sandbox', '-f', 'latex', '-t', 'json']
            if (bibPaths.length > 0) {
              astArgs.push('--citeproc')
              for (const bib of bibPaths)
                astArgs.push('--bibliography', safeJoin(projectDir, bib))
            }
            return { rootDir, cwd, source, astArgs, projectFiles }
          } finally {
            releasePreparation?.()
            releaseProject()
          }
        })()
        const { rootDir, cwd, source, astArgs, projectFiles } = prepared
        signal.throwIfAborted()
        const releaseConverter = await acquireUntilClosed(
          this.semaphore.acquire().then(([, release]) => release),
          signal,
          ticket => this.trackAdmission(ticket)
        )
        try {
          const ast = await this.run(astArgs, cwd, source, signal)
          const safe = sanitizeAst(JSON.parse(ast.toString('utf8')), {
            rootDir,
            projectFiles,
          })
          const [major, minor] = pandoc.version
          const embed =
            major > 2 || (major === 2 && minor >= 19)
              ? '--embed-resources'
              : '--self-contained'
          const writerArgs: Record<ExportFormat, string[]> = {
            docx: ['-t', 'docx'],
            md: ['-t', 'markdown-citations', '--standalone'],
            html: ['-t', 'html5', '--standalone', embed, '--mathml'],
          }
          // Stream the writer result through the same cap as the AST, not an unbounded disk file.
          return await this.run(
            ['-f', 'json', ...writerArgs[format], '-o', '-'],
            cwd,
            JSON.stringify(safe),
            signal
          )
        } finally {
          releaseConverter()
        }
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true })
      }
    })
    this.jobs.set(job, { projectId: project.id, controller })
    void job.finally(() => this.jobs.delete(job)).catch(() => {})
    return job
  }

  private async run(
    args: string[],
    cwd: string,
    input: string,
    signal: AbortSignal
  ) {
    signal.throwIfAborted()
    let result: PandocResult
    try {
      result = await runPandoc(this.ctx.config.pandocPath, args, {
        cwd,
        input,
        timeoutMs: TIMEOUT_MS,
        signal,
      })
    } catch (err) {
      if (err instanceof PandocMissingError) throw converterUnavailable()
      if (err instanceof PandocOutputLimitError)
        throw new HttpError(413, 'too_large', err.message)
      throw err
    }
    signal.throwIfAborted()
    if (result.timedOut)
      throw new HttpError(
        504,
        'export_failed',
        `Export timed out after ${TIMEOUT_MS / 1000} s`
      )
    if (result.exitCode !== 0) {
      this.log.warn({ args, stderr: result.stderr }, 'pandoc failed')
      const reason = result.stderr.trim().split('\n').slice(-3).join(' ')
      throw new HttpError(
        422,
        'export_failed',
        `Export failed${reason ? `: ${reason}` : ''}`
      )
    }
    return result.stdout
  }
}
