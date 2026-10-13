// Adapted from Overleaf services/web/frontend/js/features/source-editor/extensions/tabs-listener.ts (AGPL-3.0)
import { EditorView } from '@codemirror/view'
import { ySyncAnnotation } from 'y-codemirror.next'

export const TAB_USER_EDIT_EVENT = 'tab-user-edit'

/** Fires `TAB_USER_EDIT_EVENT` on local edits, which pin a preview tab. */
export const tabsEvents = new EventTarget()

/** Local edits only: remote updates and Yjs undo/redo carry `ySyncAnnotation`. */
export const tabsListener = () =>
  EditorView.updateListener.of(update => {
    if (!update.docChanged) return
    if (
      update.transactions.some(
        tr => tr.docChanged && !tr.annotation(ySyncAnnotation)
      )
    ) {
      tabsEvents.dispatchEvent(new Event(TAB_USER_EDIT_EVENT))
    }
  })
