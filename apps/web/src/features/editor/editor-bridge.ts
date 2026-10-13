import { EditorView } from '@codemirror/view'
import { create } from 'zustand'
import { useEditorStore } from './editor-store'

/**
 * The one live CodeMirror view of the editor page, and the doc whose state it
 * currently shows. Set by the source editor component; read by features that
 * live outside it (compile logs, SyncTeX, project search, outline, menus).
 */
export const useEditorBridge = create<{
  view: EditorView | null
  /** Doc id whose EditorState is installed in `view` (null while switching). */
  docId: string | null
}>(() => ({ view: null, docId: null }))

export function getEditorView(): EditorView | null {
  return useEditorBridge.getState().view
}

/** Called by the source editor after installing a doc's state in the view. */
export function setEditorView(view: EditorView | null, docId: string | null) {
  useEditorBridge.setState({ view, docId })
}

/** Resolves with the view once `docId` is the installed doc (or null on timeout). */
export function waitForDoc(
  docId: string,
  timeoutMs = 5000
): Promise<EditorView | null> {
  const current = useEditorBridge.getState()
  if (current.view && current.docId === docId)
    return Promise.resolve(current.view)
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      unsubscribe()
      resolve(null)
    }, timeoutMs)
    const unsubscribe = useEditorBridge.subscribe(state => {
      if (state.view && state.docId === docId) {
        window.clearTimeout(timer)
        unsubscribe()
        resolve(state.view)
      }
    })
  })
}

export type GoToTarget = {
  docId: string
  /** 1-based line. */
  line: number
  /** 0-based column; ignored when < 0. */
  column?: number
  /** Select `[from, to)` (absolute offsets) instead of placing a cursor. */
  selection?: { from: number; to: number }
}

/** Opens a doc and moves the cursor (or selection) there, scrolled to the centre. */
export async function goToPosition(target: GoToTarget) {
  useEditorStore.getState().openDoc(target.docId)
  const view = await waitForDoc(target.docId)
  if (!view) return
  const { doc } = view.state
  let anchor: number
  let head: number
  if (target.selection) {
    anchor = Math.min(target.selection.from, doc.length)
    head = Math.min(target.selection.to, doc.length)
  } else {
    const line = doc.line(Math.max(1, Math.min(target.line, doc.lines)))
    const column =
      target.column != null && target.column > 0 ? target.column : 0
    anchor = head = Math.min(line.from + column, line.to)
  }
  view.dispatch({
    selection: { anchor, head },
    effects: EditorView.scrollIntoView(head, { y: 'center' }),
  })
  view.focus()
}

/** 1-based line and 0-based column of the main cursor in the open doc. */
export function getCursorPosition(): {
  docId: string
  line: number
  column: number
} | null {
  const { view, docId } = useEditorBridge.getState()
  if (!view || !docId) return null
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return { docId, line: line.number, column: head - line.from }
}
