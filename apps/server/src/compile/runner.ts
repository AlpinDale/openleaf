import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '../config.js'
import { recoverSandboxArchive } from './artifacts.js'
import { safeJoin } from './materialize.js'

export interface RunSpec {
  key: string
  dir: string
  cmd: string[]
  image: string
  timeoutMs: number
  env?: Record<string, string>
  sourcePaths: ReadonlySet<string>
}

export interface RunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  killed: boolean
  durationMs: number
}

export interface Runner {
  readonly dirInRunner: (dir: string) => string
  run(spec: RunSpec): Promise<RunResult>
  kill(key: string): Promise<void>
  killPrefix(prefix: string): Promise<void>
}

const OUTPUT_CAP = 2 * 1024 * 1024

/** Collects a stream into a string, keeping at most OUTPUT_CAP bytes. */
function capture(stream: NodeJS.ReadableStream | null) {
  const chunks: Buffer[] = []
  let size = 0
  stream?.on('data', (chunk: Buffer) => {
    if (size >= OUTPUT_CAP) return
    const room = OUTPUT_CAP - size
    const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk
    chunks.push(part)
    size += part.byteLength
  })
  return () => Buffer.concat(chunks).toString('utf8')
}

type Running = { kill: () => Promise<void>; killed: boolean }

/**
 * Spawns a process and resolves with its captured output. `onTimeout`/`kill`
 * are delegated so each runner can stop its own process tree.
 */
function runProcess(
  child: ChildProcess,
  spec: RunSpec,
  running: Map<string, Running>,
  stop: () => Promise<void>
): Promise<RunResult> {
  const started = Date.now()
  const stdout = capture(child.stdout)
  const stderr = capture(child.stderr)
  const entry: Running = { kill: stop, killed: false }
  running.set(spec.key, entry)
  let timedOut = false
  let stopping: Promise<void> | undefined
  const stopOnce = () => (stopping ??= stop())
  entry.kill = stopOnce
  const timer = setTimeout(() => {
    timedOut = true
    void stopOnce()
  }, spec.timeoutMs)
  return new Promise((resolve, reject) => {
    child.on('error', err => {
      clearTimeout(timer)
      if (running.get(spec.key) === entry) running.delete(spec.key)
      reject(err)
    })
    child.on('close', async code => {
      // A stopped Docker CLI is not proof that the container was removed.
      if (stopping) await stopping
      clearTimeout(timer)
      if (running.get(spec.key) === entry) running.delete(spec.key)
      resolve({
        exitCode: code,
        stdout: stdout(),
        stderr: stderr(),
        timedOut,
        killed: entry.killed && !timedOut,
        durationMs: Date.now() - started,
      })
    })
  })
}

export class HostRunner implements Runner {
  private running = new Map<string, Running>()

  constructor(private readonly texmfVar: string) {}

  readonly dirInRunner = (dir: string) => dir

  run(spec: RunSpec): Promise<RunResult> {
    const [command, ...args] = spec.cmd
    const child = spawn(command, args, {
      cwd: spec.dir,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: spec.dir,
        // Keep font/format caches out of the compile dir and shared across compiles.
        TEXMFVAR: this.texmfVar,
        ...spec.env,
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stop = async () => {
      if (child.pid === undefined) return
      try {
        // The leader may have exited while descendants still hold the pipes.
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    return runProcess(child, spec, this.running, stop).finally(stop)
  }

  async kill(key: string) {
    const entry = this.running.get(key)
    if (!entry) return
    entry.killed = true
    await entry.kill()
  }

  async killPrefix(prefix: string) {
    await Promise.all(
      [...this.running.keys()]
        .filter(key => key.startsWith(prefix))
        .map(key => this.kill(key))
    )
  }
}

export class DockerRunner implements Runner {
  private readonly running = new Map<string, Running>()

  constructor(private readonly config: Config) {}

  readonly dirInRunner = () => '/compile'

  run(spec: RunSpec): Promise<RunResult> {
    const name = `openleaf-${spec.key}-${randomBytes(4).toString('hex')}`
    const children = new Set<ChildProcess>()
    let stopped = false
    let removing: Promise<void> | undefined
    const remove = () =>
      (removing ??= new Promise<void>(resolve => {
        const cleanup = spawn('docker', ['rm', '--force', name], {
          stdio: 'ignore',
          timeout: 10_000,
          killSignal: 'SIGKILL',
        })
        cleanup.on('error', () => resolve())
        cleanup.on('close', () => resolve())
      }))
    const stop = async () => {
      stopped = true
      for (const child of children) child.kill('SIGKILL')
      await remove()
    }
    const entry: Running = { kill: stop, killed: false }
    this.running.set(spec.key, entry)
    const started = Date.now()
    const phase = (args: string[], timeoutMs: number) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      children.add(child)
      return runProcess(child, { ...spec, timeoutMs }, new Map(), stop).finally(
        () => children.delete(child)
      )
    }
    return (async () => {
      const uid = process.getuid?.() ?? 1000
      const gid = process.getgid?.() ?? 1000
      if (uid === 0)
        throw new Error(
          'Docker compilation requires an unprivileged server user'
        )
      const scratchBytes = this.config.compileScratchMb * 1024 * 1024
      const args = [
        'run',
        '--detach',
        '--rm',
        '--read-only',
        '--name',
        name,
        '--network',
        'none',
        '--user',
        '0:0',
        '--memory',
        this.config.compileMemory,
        '--memory-swap',
        this.config.compileMemory,
        '--cpus',
        this.config.compileCpus,
        '--pids-limit',
        '1024',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--tmpfs',
        '/tmp:rw,exec,size=512m',
        '--tmpfs',
        `/compile:rw,exec,size=${this.config.compileScratchMb}m,uid=${uid},gid=${gid},mode=0700`,
        '-e',
        'HOME=/tmp',
        '-e',
        'TEXMFVAR=/tmp/texmf-var',
        '-e',
        'TMPDIR=/tmp',
        '-v',
        `${spec.dir}:/input:ro`,
        '-w',
        '/',
        spec.image,
        // Only the inert watchdog is root (without capabilities). Unprivileged
        // user processes cannot stop it; it kills detached jobs even during daemon outages.
        // GNU timeout is not a PID 1 init; retain an inert shell until it exits.
        'sh',
        '-c',
        'timeout --signal=KILL "$1" sleep infinity; exit "$?"',
        'openleaf-watchdog',
        `${Math.ceil(spec.timeoutMs / 1000) + 60}s`,
      ]
      let result = await phase(args, 30_000)
      if (result.exitCode !== 0 || result.timedOut || stopped) return result
      result = await phase(
        [
          'exec',
          '--user',
          `${uid}:${gid}`,
          name,
          'cp',
          '-a',
          '--no-preserve=ownership',
          '/input/.',
          '/compile/',
        ],
        30_000
      )
      if (result.exitCode !== 0 || result.timedOut || stopped) return result
      const envArgs = Object.entries(spec.env ?? {}).flatMap(([key, value]) => [
        '-e',
        `${key}=${value}`,
      ])
      result = await phase(
        [
          'exec',
          '--user',
          `${uid}:${gid}`,
          ...envArgs,
          '-w',
          '/compile',
          name,
          'timeout',
          '--signal=KILL',
          `${Math.max(1, Math.ceil(spec.timeoutMs / 1000)) + 1}s`,
          ...spec.cmd,
        ],
        spec.timeoutMs
      )
      if (result.timedOut || stopped) return result

      const stage = await fsp.mkdtemp(`${spec.dir}.outputs-`)
      try {
        // Sources are copied from the immutable host inputs, never from the sandbox.
        for (const source of spec.sourcePaths) {
          if (stopped) return result
          const dest = safeJoin(stage, source)
          await fsp.mkdir(path.dirname(dest), { recursive: true })
          await fsp.copyFile(
            safeJoin(spec.dir, source),
            dest,
            fs.constants.COPYFILE_FICLONE
          )
        }
        if (stopped) return result
        const archive = spawn(
          'docker',
          [
            'exec',
            '--user',
            `${uid}:${gid}`,
            name,
            'tar',
            '--format=posix',
            '--one-file-system',
            '-cf',
            '-',
            '-C',
            '/compile',
            '.',
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        )
        children.add(archive)
        const stderr = capture(archive.stderr)
        const archiveExit = new Promise<number | null>((resolve, reject) => {
          archive.on('error', reject)
          archive.on('close', resolve)
        })
        let archiveTimedOut = false
        const timer = setTimeout(() => {
          archiveTimedOut = true
          void stop()
        }, 30_000)
        try {
          await Promise.all([
            recoverSandboxArchive(
              archive.stdout,
              stage,
              spec.sourcePaths,
              scratchBytes
            ),
            archiveExit.then(code => {
              if (code !== 0)
                throw new Error(
                  `Sandbox artifact collection failed: ${stderr()}`
                )
            }),
          ])
        } catch (err) {
          await stop()
          await archiveExit.catch(() => {})
          if (archiveTimedOut) return { ...result, timedOut: true }
          if (entry.killed) return result
          throw err
        } finally {
          clearTimeout(timer)
          children.delete(archive)
        }
        if (stopped) return result
        await fsp.rm(spec.dir, { recursive: true, force: true })
        await fsp.rename(stage, spec.dir)
        return result
      } finally {
        await fsp.rm(stage, { recursive: true, force: true })
      }
    })()
      .then(result => ({
        ...result,
        killed: entry.killed && !result.timedOut,
        durationMs: Date.now() - started,
      }))
      .finally(async () => {
        await remove()
        if (stopped) {
          removing = undefined
          await remove()
        }
        if (this.running.get(spec.key) === entry) this.running.delete(spec.key)
      })
  }

  async kill(key: string) {
    const entry = this.running.get(key)
    if (!entry) return
    entry.killed = true
    await entry.kill()
  }

  async killPrefix(prefix: string) {
    await Promise.all(
      [...this.running.keys()]
        .filter(key => key.startsWith(prefix))
        .map(key => this.kill(key))
    )
  }
}
