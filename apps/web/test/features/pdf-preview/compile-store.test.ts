// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompileResponse } from '@openleaf/shared'
import type { ProjectSession } from '@/features/project/session'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  logs: vi.fn(),
  toast: vi.fn(),
  goToPosition: vi.fn(),
}))
vi.mock('@/api/client', () => ({
  apiFetch: mocks.fetch,
  errorMessage: (error: Error) => error.message,
  isApiError: () => false,
}))
vi.mock('@/api/auth', () => ({ meKey: ['me'], patchMe: vi.fn() }))
vi.mock('@/api/query-client', () => ({
  queryClient: { getQueryData: vi.fn() },
}))
vi.mock('@/features/editor/editor-bridge', () => ({
  getCursorPosition: vi.fn(),
  goToPosition: mocks.goToPosition,
}))
vi.mock('@/features/editor/editor-store', () => ({
  useEditorStore: {
    getState: () => ({ layout: 'sideBySide', setLayout: vi.fn() }),
  },
}))
vi.mock('@/features/toasts', () => ({ showToast: mocks.toast }))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/utils/debugging', () => ({ debugConsole: { warn: vi.fn() } }))
vi.mock('@/features/pdf-preview/util/output-files', () => ({
  emptyLogEntries: () => ({ all: [] }),
  handleLogFiles: mocks.logs,
}))
import {
  connectCompileStore,
  syncToCode,
  useCompileStore,
} from '@/features/pdf-preview/compile-store'

const result: CompileResponse = {
  status: 'success',
  buildId: 'build',
  rootDocPath: 'main.tex',
  outputFiles: [],
  chktex: [],
  logPathPrefix: '',
  durationMs: 1,
}
const session = () =>
  ({
    waitForSync: vi.fn().mockResolvedValue(undefined),
    getEntryByPath: vi.fn(),
  }) as unknown as ProjectSession
const cleanups: (() => void)[] = []
function connect(projectId: string, currentSession = session()) {
  cleanups.push(
    connectCompileStore({ projectId, session: currentSession, role: 'editor' })
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('BroadcastChannel', undefined)
  mocks.fetch.mockReset()
  mocks.logs.mockReset()
  mocks.toast.mockClear()
  mocks.goToPosition.mockClear()
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('project-bound compile operations', () => {
  it('does not compile an old project after its sync wait finishes', async () => {
    const sync = Promise.withResolvers<void>()
    const old = session()
    old.waitForSync = () => sync.promise
    connect('old', old)
    const pending = useCompileStore.getState().compile()
    connect('new')
    sync.resolve()
    await pending
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(useCompileStore.getState().status).toBe('idle')
  })

  it('ignores a failed compile after switching projects', async () => {
    const request = Promise.withResolvers<CompileResponse>()
    mocks.fetch.mockReturnValue(request.promise)
    connect('old')
    const pending = useCompileStore.getState().compile()
    await Promise.resolve()
    connect('new')
    request.reject(new Error('old request failed'))
    await pending
    expect(useCompileStore.getState().error).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('does not install logs that finish after switching projects', async () => {
    const logs = Promise.withResolvers<{
      logEntries: { all: [] }
      log: string
    }>()
    mocks.fetch.mockResolvedValue(result)
    mocks.logs.mockReturnValue(logs.promise)
    connect('old')
    const pending = useCompileStore.getState().compile()
    await Promise.resolve()
    await Promise.resolve()
    connect('new')
    logs.resolve({ logEntries: { all: [] }, log: 'old log' })
    await pending
    expect(useCompileStore.getState().result).toBeNull()
    expect(useCompileStore.getState().rawLog).toBe('')
  })

  it('does not clear the new project when an old cache deletion completes', async () => {
    const request = Promise.withResolvers<void>()
    mocks.fetch.mockReturnValue(request.promise)
    connect('old')
    const pending = useCompileStore.getState().clearCache()
    connect('new')
    useCompileStore.setState({ rawLog: 'new log' })
    request.resolve()
    await pending
    expect(useCompileStore.getState().rawLog).toBe('new log')
  })

  it('does not navigate in the new project for an old SyncTeX response', async () => {
    const request = Promise.withResolvers<{
      code: { path: string; line: number; column: number }[]
    }>()
    mocks.fetch.mockReturnValue(request.promise)
    connect('old')
    const pending = syncToCode({ page: 1, h: 0, v: 0 })
    connect('new')
    request.resolve({ code: [{ path: 'main.tex', line: 1, column: 0 }] })
    await pending
    expect(mocks.goToPosition).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
