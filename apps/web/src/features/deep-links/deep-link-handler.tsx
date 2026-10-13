import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useThreads } from '@/api/threads'
import {
  type GoToTarget,
  goToPosition,
  waitForDoc,
} from '@/features/editor/editor-bridge'
import { type RailTab, useEditorStore } from '@/features/editor/editor-store'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useIdeTree } from '@/features/ide-react/openleaf-ide'
import { useConnectionStore } from '@/features/project/session'
import { useProjectSession } from '@/features/project/session-context'
import {
  changeFrom,
  changeTo,
  readChanges,
  readCommentAnchors,
} from '@/features/review/changes'
import { useReviewStore } from '@/features/review/review-store'
import { setStoredFirstVisibleLine } from '@/features/source-editor/extensions/scroll-position'
import { showToast } from '@/features/toasts'
import { t } from '@/i18n'

/**
 * Overleaf's deep link parameters plus `line`:
 * `?doc=<entryId>&line=<n>&comment=<threadId>&change=<changeId>&open=<panel>`.
 */
const DEEP_LINK_PARAMS = ['doc', 'line', 'comment', 'change', 'open'] as const

type DeepLink = {
  docId: string | null
  /** 1-based. */
  line: number | null
  threadId: string | null
  changeId: string | null
  panel: string | null
}

const RAIL_PANELS: Record<string, RailTab> = {
  'file-tree': 'files',
  files: 'files',
  search: 'search',
  symbols: 'symbols',
}

function readDeepLink(params: URLSearchParams): DeepLink | null {
  if (!DEEP_LINK_PARAMS.some(param => params.has(param))) return null
  const line = Number.parseInt(params.get('line') ?? '', 10)
  return {
    docId: params.get('doc'),
    line: Number.isFinite(line) && line > 0 ? line : null,
    threadId: params.get('comment'),
    changeId: params.get('change'),
    panel: params.get('open'),
  }
}

/**
 * Resolves after the editor restored the newly opened doc's stored scroll
 * position (which would otherwise drag it away from the target), or shortly
 * after when there was nothing to restore.
 */
function scrollRestored(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  const done = () => {
    window.clearTimeout(timer)
    window.removeEventListener('editor:scroll-position-restored', done)
    resolve()
  }
  const timer = window.setTimeout(done, 300)
  window.addEventListener('editor:scroll-position-restored', done)
  return promise
}

/** Lines shown above the target when a scroll restore puts it near the top. */
const CONTEXT_LINES = 5

/**
 * Opens the target (whose 1-based line is `line`), then re-centres it once
 * the editor's scroll restore has run. The restore reads the doc's stored
 * scroll position, so that's pointed at the target first.
 */
async function goTo(target: GoToTarget, line: number) {
  setStoredFirstVisibleLine(target.docId, Math.max(1, line - CONTEXT_LINES))
  // the restore runs two ticks after the doc's state is installed
  await goToPosition(target)
  await scrollRestored()
  const view = await waitForDoc(target.docId, 0)
  if (!view) return
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, {
      y: 'center',
    }),
  })
}

function openReviewPanel() {
  useEditorStore.setState({ reviewOpen: true, historyOpen: false })
  useReviewStore.setState({ tab: 'current' })
}

const notFound = (message: string) =>
  showToast({ type: 'warning', content: message, delay: 4000 })

/**
 * Handles deep link parameters on the editor page once the project has
 * synced: opens the doc at a line, or selects a comment's or tracked change's
 * range with its review card focused, or opens a panel. Toasts when the
 * target doesn't exist; the parameters are stripped from the URL right away.
 */
export function DeepLinkHandler() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [link] = useState(() => readDeepLink(searchParams))
  const session = useProjectSession()
  const tree = useIdeTree()
  const syncedOnce = useConnectionStore(s => s.syncedOnce)
  const threads = useThreads(session.projectId).data
  const handled = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on mount
  useEffect(() => {
    if (!link) return
    setSearchParams(
      params => {
        const next = new URLSearchParams(params)
        for (const param of DEEP_LINK_PARAMS) next.delete(param)
        return next
      },
      { replace: true }
    )
  }, [])

  const needsThreads = !!link?.threadId
  const ready = syncedOnce && (!needsThreads || threads !== undefined)

  useEffect(() => {
    if (!link || !ready || handled.current) return
    handled.current = true
    const { ydoc, texts } = session
    const index = indexTree(tree)

    if (link.panel === 'review-panel') openReviewPanel()
    else if (link.panel === 'history')
      useEditorStore.getState().setHistoryOpen(true)
    else if (link.panel && RAIL_PANELS[link.panel])
      useEditorStore.setState({ railTab: RAIL_PANELS[link.panel] })

    // a review card is focused while the selection is inside its range
    const selectInReview = (docId: string, from: number, to: number) => {
      const text = texts.get(docId)?.toString() ?? ''
      const line = text.slice(0, from).split('\n').length
      openReviewPanel()
      void goTo({ docId, line, selection: { from, to } }, line)
    }

    if (link.threadId) {
      const anchor = readCommentAnchors(ydoc).find(a => a.id === link.threadId)
      const thread = threads?.find(item => item.id === link.threadId)
      if (anchor && thread && thread.resolvedAt === null)
        selectInReview(anchor.docId, anchor.from, anchor.to)
      else notFound(t('comment_not_found'))
      return
    }

    if (link.changeId) {
      const change = readChanges(ydoc).find(item => item.id === link.changeId)
      if (change)
        selectInReview(change.docId, changeFrom(change), changeTo(change))
      else notFound(t('tracked_change_not_found'))
      return
    }

    let docId = useEditorStore.getState().openDocId
    if (link.docId) {
      const entry = index.byId.get(link.docId)
      if (entry?.kind === 'file') {
        useEditorStore.getState().openFile(entry.id)
        return
      }
      if (entry?.kind !== 'doc') {
        notFound(t('linked_file_not_found'))
        return
      }
      docId = entry.id
    }
    if (!docId) return
    if (link.line !== null) void goTo({ docId, line: link.line }, link.line)
    else useEditorStore.getState().openDoc(docId)
  }, [link, ready, session, tree, threads])

  return null
}
