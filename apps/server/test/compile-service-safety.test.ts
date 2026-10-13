import fs from 'node:fs/promises'
import path from 'node:path'
import type { Mutex } from 'async-mutex'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileDir, compileKey } from '../src/compile/materialize.js'
import type { Runner, RunResult, RunSpec } from '../src/compile/runner.js'
import { CompileService } from '../src/compile/service.js'
import { projects } from '../src/db/schema.js'
import { projectLock } from '../src/tree/locks.js'
import { createProject, createTestApp, registerUser } from './helpers.js'

const services: CompileService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
})

function controlledRunner() {
  const started = Promise.withResolvers<RunSpec>()
  const held = Promise.withResolvers<RunResult>()
  const result: RunResult = {
    exitCode: 0,
    stdout: 'Words in text: 3\n',
    stderr: '',
    timedOut: false,
    killed: false,
    durationMs: 0,
  }
  let key: string | null = null
  const runner: Runner = {
    dirInRunner: dir => dir,
    async run(spec) {
      if (key === null && spec.cmd[0] === 'latexmk') {
        key = spec.key
        started.resolve(spec)
        return held.promise
      }
      return result
    },
    async kill(requested) {
      if (requested === key) held.resolve({ ...result, killed: true })
    },
    async killPrefix(prefix) {
      if (key?.startsWith(prefix)) held.resolve({ ...result, killed: true })
    },
  }
  return { runner, started: started.promise, held, result }
}

describe('compile service lifetime and lock ordering', async () => {
  const { app, dataDir } = await createTestApp({
    OPENLEAF_MAX_CONCURRENT_COMPILES: '1',
  })
  const user = await registerUser(app)
  const options = { draft: false, stopOnFirstError: false, syntaxCheck: false }

  it('does not deadlock queued wordcount against a compile for the same key', async () => {
    const firstId = await createProject(app, user)
    const secondId = await createProject(app, user)
    const first = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, firstId))
      .get()
    const second = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, secondId))
      .get()
    if (!first || !second) throw new Error('missing fixture project')
    const control = controlledRunner()
    const service = new CompileService(app.ctx, app.log, control.runner)
    services.push(service)
    const running = service.compile(first, user.id, options)
    await control.started
    const words = service.wordcount(second, user.id)
    // Start the queued job's deterministic microtask before the conflicting compile.
    await Promise.resolve()
    const conflicting = service
      .compile(second, user.id, options)
      .catch(error => error)
    control.held.resolve(control.result)
    const [, count, conflict] = await Promise.all([running, words, conflicting])
    expect(count.textWords).toBe(3)
    expect(conflict).toMatchObject({
      statusCode: 409,
      code: 'compile_in_progress',
    })
  })

  it('drains an active project and rejects subsequent jobs before deletion', async () => {
    const id = await createProject(app, user)
    const project = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get()
    if (!project) throw new Error('missing fixture project')
    const control = controlledRunner()
    const service = new CompileService(app.ctx, app.log, control.runner)
    services.push(service)
    const running = service.compile(project, user.id, options)
    await control.started
    await service.closeProject(id)
    expect((await running).status).toBe('terminated')
    await expect(
      service.compile(project, user.id, options)
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(service.wordcount(project, user.id)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('stops a compile queued behind another user/project', async () => {
    const firstId = await createProject(app, user)
    const secondId = await createProject(app, user)
    const first = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, firstId))
      .get()
    const second = app.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, secondId))
      .get()
    if (!first || !second) throw new Error('missing fixture project')
    const control = controlledRunner()
    const service = new CompileService(app.ctx, app.log, control.runner)
    services.push(service)
    const queuedReady = Promise.withResolvers<void>()
    let imageChecks = 0
    service.imageGate = async () => {
      if (++imageChecks === 2) queuedReady.resolve()
    }
    const running = service.compile(first, user.id, options)
    await control.started
    const queued = service.compile(second, user.id, options)
    await queuedReady.promise
    await service.stop(second.id, user.id)
    control.held.resolve(control.result)
    await running
    expect((await queued).status).toBe('terminated')
  })

  it.each(['compile', 'wordcount', 'synctex'] as const)(
    '%s waiting behind a receive/tree lock does not block another project or shutdown',
    async kind => {
      const blockedId = await createProject(app, user)
      const otherId = await createProject(app, user)
      const blockedProject = app.ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, blockedId))
        .get()
      const otherProject = app.ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, otherId))
        .get()
      if (!blockedProject || !otherProject)
        throw new Error('missing fixture project')
      if (kind === 'synctex') {
        const dir = compileDir(dataDir, compileKey(blockedId, user.id))
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, 'output.pdf'), '%PDF-fixture')
        await fs.writeFile(path.join(dir, 'output.synctex.gz'), 'fixture')
      }
      const mutex = projectLock(blockedId)
      const releaseProject = await mutex.acquire()
      const attempted = Promise.withResolvers<void>()
      const acquire = mutex.acquire.bind(mutex)
      const spy = vi.spyOn(mutex, 'acquire').mockImplementation(() => {
        attempted.resolve()
        return acquire()
      })
      const control = controlledRunner()
      const service = new CompileService(app.ctx, app.log, control.runner)
      services.push(service)
      const blocked = (
        kind === 'compile'
          ? service.compile(blockedProject, user.id, options)
          : kind === 'wordcount'
            ? service.wordcount(blockedProject, user.id)
            : service.synctexFromCode(blockedProject, user.id, {
                path: 'main.tex',
                line: 1,
                column: 0,
              })
      ).catch(error => error)
      try {
        await attempted.promise
        const other = service.compile(otherProject, user.id, options)
        const started = await control.started
        expect(started.key).toBe(compileKey(otherId, user.id))
        control.held.resolve(control.result)
        await other
        // Shutdown must finish while the external Git/tree lock is still held.
        await service.close()
        expect(await blocked).toMatchObject({ statusCode: 404 })
        expect(mutex.isLocked()).toBe(true)
      } finally {
        spy.mockRestore()
        releaseProject()
        await blocked
      }
    }
  )

  it('keeps abandoned lock tickets budgeted until their late grant is released', async () => {
    const control = controlledRunner()
    const service = new CompileService(app.ctx, app.log, control.runner)
    services.push(service)
    const held: { id: string; mutex: Mutex; release: () => void }[] = []
    try {
      for (let index = 0; index < 32; index++) {
        const id = await createProject(app, user)
        const project = app.ctx.db
          .select()
          .from(projects)
          .where(eq(projects.id, id))
          .get()
        if (!project) throw new Error('missing fixture project')
        const mutex = projectLock(id)
        const release = await mutex.acquire()
        held.push({ id, mutex, release })
        const attempted = Promise.withResolvers<void>()
        const acquire = mutex.acquire.bind(mutex)
        const spy = vi.spyOn(mutex, 'acquire').mockImplementation(() => {
          attempted.resolve()
          return acquire()
        })
        const blocked = service
          .compile(project, user.id, options)
          .catch(error => error)
        await attempted.promise
        await service.closeProject(id)
        expect(await blocked).toMatchObject({ statusCode: 404 })
        spy.mockRestore()
      }
      const id = await createProject(app, user)
      const project = app.ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .get()
      if (!project) throw new Error('missing fixture project')
      await expect(
        service.compile(project, user.id, options)
      ).rejects.toMatchObject({ statusCode: 429 })
    } finally {
      for (const ticket of held) ticket.release()
      await Promise.all(held.map(ticket => ticket.mutex.waitForUnlock()))
      for (const ticket of held)
        await expect(
          fs.stat(compileDir(dataDir, compileKey(ticket.id, user.id)))
        ).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 15_000)
})
