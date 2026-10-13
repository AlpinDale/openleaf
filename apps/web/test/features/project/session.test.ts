// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectSession,
  useConnectionStore,
  type ProjectSession,
} from '@/features/project/session'

const state = vi.hoisted(() => ({
  providers: [] as {
    hasUnsyncedChanges: boolean
    options: {
      onStatus: (event: { status: string }) => void
      onStateless: (event: { payload: string }) => void
    }
    listeners: Map<string, () => void>
    destroy: () => void
  }[],
}))
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProviderWebsocket: class {
    destroy() {}
  },
  HocuspocusProvider: class {
    hasUnsyncedChanges = false
    awareness = null
    listeners = new Map<string, () => void>()
    destroy = vi.fn()
    constructor(public options: (typeof state.providers)[number]['options']) {
      state.providers.push(this)
    }
    attach() {}
    on(event: string, listener: () => void) {
      this.listeners.set(event, listener)
    }
    off(event: string) {
      this.listeners.delete(event)
    }
  },
}))
vi.mock('@/utils/debugging', () => ({
  debugConsole: { warn: vi.fn(), error: vi.fn() },
}))
const sessions: ProjectSession[] = []
function open() {
  const session = createProjectSession(
    '00000000-0000-4000-8000-000000000000',
    new QueryClient()
  )
  sessions.push(session)
  return session
}
afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy()
  state.providers.splice(0)
})

describe('project session lifecycle', () => {
  it('rejects pending synchronization and removes its listener on destruction', async () => {
    const session = open()
    const provider = state.providers[0]
    provider.hasUnsyncedChanges = true
    const pending = session.waitForSync()
    const rejected = expect(pending).rejects.toThrow('Project session closed')
    session.destroy()
    await rejected
    expect(provider.listeners.size).toBe(0)
    await expect(session.waitForSync()).rejects.toThrow(
      'Project session closed'
    )
  })

  it('ignores callbacks from a destroyed provider', () => {
    const session = open()
    const old = state.providers[0]
    session.destroy()
    open()
    old.options.onStatus({ status: 'connected' })
    expect(useConnectionStore.getState().status).toBe('connecting')
  })

  it('ignores valid JSON that is not a project event', () => {
    open()
    const provider = state.providers[0]
    for (const payload of ['null', '[]', '{}', '{"type":"unsupported"}']) {
      expect(() => provider.options.onStateless({ payload })).not.toThrow()
    }
  })
})
