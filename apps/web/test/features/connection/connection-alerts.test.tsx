// @vitest-environment jsdom
import { FORCED_CLOSE_REASONS } from '@openleaf/shared'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionAlerts } from '@/features/connection/connection-alerts'

const state = vi.hoisted(() => ({
  hasUnsyncedChanges: true,
  listeners: new Map<string, (event?: unknown) => void>(),
  detach: vi.fn(),
  attach: vi.fn(),
}))
vi.mock('@/features/project/session-context', () => {
  const provider = {
    get hasUnsyncedChanges() {
      return state.hasUnsyncedChanges
    },
    detach: state.detach,
    attach: state.attach,
    on(event: string, listener: (event?: unknown) => void) {
      state.listeners.set(event, listener)
    },
    off(event: string) {
      state.listeners.delete(event)
    },
  }
  return { useProjectSession: () => ({ provider }) }
})
vi.mock('@/features/editor/editor-bridge', () => ({
  getEditorView: () => ({ state: { doc: { toString: () => 'unsaved text' } } }),
}))
vi.mock('@/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/shared/components/notification', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock('@/shared/components/ol/ol-modal', () => {
  const Section = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
  return {
    OLModal: Section,
    OLModalBody: Section,
    OLModalFooter: Section,
    OLModalHeader: Section,
    OLModalTitle: Section,
  }
})

beforeEach(() => {
  vi.useFakeTimers()
  state.hasUnsyncedChanges = true
  state.detach.mockClear()
  state.attach.mockClear()
})
afterEach(() => {
  cleanup()
  state.listeners.clear()
  vi.useRealTimers()
})

function close(reason: string) {
  act(() => state.listeners.get('close')?.({ event: { reason } }))
}

describe('realtime quota recovery', () => {
  it.each([
    [FORCED_CLOSE_REASONS.stateTooLarge, 'connection_state_too_large_detail'],
    [FORCED_CLOSE_REASONS.invalidUpdate, 'connection_invalid_update_detail'],
  ])('shows distinct recovery for %s', (reason, message) => {
    render(<ConnectionAlerts />)
    close(reason)
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByText('connection_update_too_large_detail')).toBeNull()
    expect(state.detach).toHaveBeenCalledOnce()
    expect(screen.getByText('show_local_file_contents')).toBeTruthy()
  })

  it('keeps local edits and reconnects after rate limiting without requesting reload', () => {
    render(<ConnectionAlerts />)
    close(FORCED_CLOSE_REASONS.rateLimited)
    expect(screen.getByText('connection_rate_limited')).toBeTruthy()
    expect(screen.queryByText('reload_editor')).toBeNull()
    expect(state.detach).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(59_999))
    expect(state.attach).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(state.attach).toHaveBeenCalledOnce()
    act(() => state.listeners.get('synced')?.())
    expect(screen.getByText('connection_rate_limited')).toBeTruthy()
    state.hasUnsyncedChanges = false
    act(() => state.listeners.get('unsyncedChanges')?.())
    expect(screen.queryByText('connection_rate_limited')).toBeNull()
  })

  it('cancels a scheduled retry when the editor unmounts', () => {
    const view = render(<ConnectionAlerts />)
    close(FORCED_CLOSE_REASONS.rateLimited)
    view.unmount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(state.attach).not.toHaveBeenCalled()
  })
})
