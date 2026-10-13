import type { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { ySyncAnnotation, ySyncFacet } from 'y-codemirror.next'

/** Keeps source edits and their tracked-change records in one wire update. */
export function dispatchEditorTransactions(
  view: EditorView,
  transactions: readonly Transaction[]
) {
  const sync = view.state.facet(ySyncFacet)
  const ydoc = sync?.ytext.doc
  if (
    ydoc &&
    transactions.some(tr => tr.docChanged && !tr.annotation(ySyncAnnotation))
  ) {
    // The upstream sync plugin skips observing its own origin. Its undo plugin
    // already tracks that origin, including the nested capture-map mutations.
    ydoc.transact(() => view.update(transactions), sync)
  } else {
    view.update(transactions)
  }
}
