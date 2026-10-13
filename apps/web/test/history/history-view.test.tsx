// @vitest-environment jsdom
import type { ProjectDetails } from '@openleaf/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryView } from '@/features/history/components/history-view'

const state = vi.hoisted(() => ({ failedOid: 'new' }))
vi.mock('@/api/history', () => ({
  useHistoryVersions: () => ({
    data: {
      pages: [
        [
          {
            oid: 'new',
            parentOid: 'old',
            createdAt: 0,
            changes: [{ path: 'main.tex', op: 'modified' }],
          },
        ],
      ],
    },
    isPending: false,
  }),
  useHistoryLabels: () => ({ data: [] }),
  useHistoryTree: (_projectId: string, oid: string) =>
    oid === state.failedOid
      ? {
          isError: true,
          isSuccess: false,
          error: new Error('Snapshot unavailable'),
        }
      : { isSuccess: true, data: [] },
  useHistoryFileText: () => ({ isSuccess: false }),
  historyZipUrl: () => '/download',
  historyFileUrl: () => '/file',
  addHistoryLabel: vi.fn(),
  deleteHistoryLabel: vi.fn(),
  restoreHistoryVersion: vi.fn(),
}))
vi.mock('@/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: () => null,
}))
vi.mock('@/features/common/confirm-modal', () => ({ ConfirmModal: () => null }))
vi.mock('@/features/common/name-prompt-modal', () => ({
  NamePromptModal: () => null,
}))
vi.mock('@/features/history/components/history-version-list', () => ({
  HistoryVersionList: () => null,
}))
vi.mock('@/features/history/components/history-diff-view', () => ({
  HistoryDiffView: () => null,
}))
vi.mock('@/shared/components/notification', () => ({
  default: ({ content }: { content: string }) => (
    <div role="alert">{content}</div>
  ),
}))

const project = { id: 'project', role: 'viewer' } as ProjectDetails

afterEach(cleanup)
describe('history snapshot failures', () => {
  it.each(['old', 'new'])(
    'shows a failed %s tree instead of loading forever',
    oid => {
      state.failedOid = oid
      render(<HistoryView project={project} />)
      expect(screen.getByRole('alert').textContent).toBe('Snapshot unavailable')
      expect(screen.queryByTestId('history-restore-version')).toBeNull()
    }
  )

  it('keeps the error visible when all-files mode has no tree to list', () => {
    state.failedOid = 'new'
    render(<HistoryView project={project} />)
    fireEvent.click(screen.getByTestId('history-all-files'))
    expect(screen.getByRole('alert').textContent).toBe('Snapshot unavailable')
  })
})
