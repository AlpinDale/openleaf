import { type ChildProcess, spawn } from 'node:child_process'
import type { FastifyBaseLogger } from 'fastify'
import { HttpError } from '../errors.js'

type ImageState = 'checking' | 'ready' | 'pulling' | 'failed'

/**
 * Tracks whether each configured TeX Live image is present locally, pulling
 * missing ones in the background. Compiles with an image that isn't ready yet
 * get 503 `image_unavailable`.
 */
export class ImageAvailability {
  private readonly states = new Map<string, ImageState>()
  private readonly checks = new Map<string, Promise<void>>()
  private closed = false
  private readonly children = new Set<ChildProcess>()
  private readonly tasks = new Set<Promise<unknown>>()

  constructor(
    images: readonly string[],
    private readonly log: FastifyBaseLogger
  ) {
    for (const image of images) this.checks.set(image, this.check(image))
  }

  private docker(args: string[]): Promise<number | null> {
    if (this.closed) return Promise.resolve(null)
    const child = spawn('docker', args, {
      stdio: 'ignore',
      timeout: args[0] === 'pull' ? 15 * 60_000 : 10_000,
      killSignal: 'SIGKILL',
    })
    this.children.add(child)
    const task = new Promise<number | null>(resolve => {
      child.on('error', () => resolve(null))
      child.on('close', code => resolve(code))
    }).finally(() => this.children.delete(child))
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task))
    return task
  }

  async close() {
    this.closed = true
    for (const child of this.children) child.kill('SIGKILL')
    await Promise.allSettled([...this.tasks, ...this.checks.values()])
  }

  private async check(image: string) {
    this.states.set(image, 'checking')
    const code = await this.docker(['image', 'inspect', image])
    if (code === 0) {
      this.states.set(image, 'ready')
      return
    }
    this.pull(image)
  }

  private pull(image: string) {
    if (this.closed) return
    this.states.set(image, 'pulling')
    this.log.info({ image }, 'pulling TeX Live image')
    void this.docker(['pull', image]).then(code => {
      if (code === 0) {
        this.states.set(image, 'ready')
        this.log.info({ image }, 'TeX Live image ready')
      } else {
        this.states.set(image, 'failed')
        this.log.error({ image, code }, 'failed to pull TeX Live image')
      }
    })
  }

  async assertReady(image: string) {
    if (this.closed)
      throw new HttpError(503, 'image_unavailable', 'Server is shutting down')
    await this.checks.get(image)
    const state = this.states.get(image)
    if (state === 'ready') return
    if (state === 'failed') this.pull(image)
    throw new HttpError(
      503,
      'image_unavailable',
      `TeX Live image ${image} is still downloading`
    )
  }
}
