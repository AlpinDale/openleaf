import { spawn } from 'node:child_process'

const MAX_STDERR = 64 * 1024
const MAX_STDOUT = 64 * 1024 * 1024

export type PandocResult = {
  exitCode: number | null
  stdout: Buffer
  stderr: string
  timedOut: boolean
}

export class PandocMissingError extends Error {}
export class PandocOutputLimitError extends Error {}

/** Runs pandoc with `input` on stdin; SIGKILLs it after `timeoutMs`. */
export function runPandoc(
  executable: string,
  args: string[],
  opts: { cwd: string; input: string; timeoutMs: number; signal?: AbortSignal }
): Promise<PandocResult> {
  const { promise, resolve, reject } = Promise.withResolvers<PandocResult>()
  const child = spawn(executable, args, {
    cwd: opts.cwd,
    env: { PATH: process.env.PATH ?? '', HOME: opts.cwd, LANG: 'C.UTF-8' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })
  const stdout: Buffer[] = []
  let stderr = ''
  let timedOut = false
  let outputSize = 0
  let outputLimit = false
  const stop = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
  opts.signal?.addEventListener('abort', stop, { once: true })
  if (opts.signal?.aborted) stop()
  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, opts.timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => {
    outputSize += chunk.length
    if (outputSize > MAX_STDOUT) {
      outputLimit = true
      stop()
    } else stdout.push(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const room = MAX_STDERR - Buffer.byteLength(stderr)
    if (room > 0) stderr += chunk.subarray(0, room).toString('utf8')
  })
  // 'error' and 'close' can both fire; the first one settles the promise.
  child.on('error', err => {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', stop)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      reject(new PandocMissingError(`${executable} not found`))
    else reject(err)
  })
  child.on('close', exitCode => {
    clearTimeout(timer)
    stop()
    opts.signal?.removeEventListener('abort', stop)
    if (outputLimit) {
      reject(
        new PandocOutputLimitError('Export exceeds the 64 MiB output limit')
      )
      return
    }
    resolve({ exitCode, stdout: Buffer.concat(stdout), stderr, timedOut })
  })
  // pandoc may exit before reading all of stdin (e.g. on a bad flag).
  child.stdin.on('error', () => {})
  child.stdin.end(opts.input)
  return promise
}

export type PandocInfo = { version: [number, number, number] }

const probes = new Map<string, Promise<PandocInfo | null>>()

/** `pandoc --version`, probed once per executable; `null` when unusable. */
export function probePandoc(executable: string): Promise<PandocInfo | null> {
  let probe = probes.get(executable)
  if (!probe) {
    probe = runPandoc(executable, ['--version'], {
      cwd: process.cwd(),
      input: '',
      timeoutMs: 10_000,
    }).then(
      result => {
        const match = /^pandoc(?:\.exe)?\s+(\d+)\.(\d+)(?:\.(\d+))?/m.exec(
          result.stdout.toString('utf8')
        )
        if (result.exitCode !== 0 || !match) return null
        return {
          version: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)],
        }
      },
      () => null
    )
    probes.set(executable, probe)
  }
  return probe
}
