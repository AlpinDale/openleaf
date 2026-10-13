import { setImmediate } from 'node:timers/promises'
import type { Semaphore } from 'async-mutex'
import { describe, expect, it } from 'vitest'
import { HistoryService } from '../src/history/service.js'
import { createProject, createTestApp, registerUser } from './helpers.js'

type NativeControls = {
  nativeGitSlots: Semaphore
  collectGarbage(projectId: string): void
  gitMetadata(
    projectId: string,
    args: string[],
    maxBuffer: number
  ): Promise<Buffer>
}

describe('history native Git scheduling', async () => {
  const { app } = await createTestApp({
    OPENLEAF_MAX_CONCURRENT_GIT_OPERATIONS: '1',
  })

  it('cancels queued project maintenance without waiting for unrelated slot holders and drains abandoned tickets on shutdown', async () => {
    const history = new HistoryService(app.ctx, app.log)
    const controls = history as unknown as NativeControls
    const [, release] = await controls.nativeGitSlots.acquire()
    let released = false
    try {
      controls.collectGarbage('first-project')
      controls.collectGarbage('second-project')
      await history.drainGarbageCollectors('first-project')
      expect(controls.nativeGitSlots.getValue()).toBe(0)
      let drained = false
      const all = history.drainGarbageCollectors().then(() => {
        drained = true
      })
      await setImmediate()
      expect(drained).toBe(false)
      release()
      released = true
      await all
      expect(controls.nativeGitSlots.getValue()).toBe(1)
      controls.collectGarbage('after-shutdown')
      expect(controls.nativeGitSlots.getValue()).toBe(1)
    } finally {
      if (!released) release()
      await history.drainGarbageCollectors()
    }
  })

  it('queues foreground metadata behind the same bounded native process slots', async () => {
    const user = await registerUser(app)
    const id = await createProject(app, user)
    const history = new HistoryService(app.ctx, app.log)
    const controls = history as unknown as NativeControls
    const [, release] = await controls.nativeGitSlots.acquire()
    let finished = false
    const pending = controls
      .gitMetadata(id, ['rev-parse', '--is-bare-repository'], 128)
      .then(result => {
        finished = true
        return result
      })
    try {
      await setImmediate()
      expect(finished).toBe(false)
    } finally {
      release()
    }
    expect((await pending).toString('ascii').trim()).toBe('true')
    await history.drainGarbageCollectors()
  })
})
