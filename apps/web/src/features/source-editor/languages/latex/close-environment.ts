import { completionStatus, selectedCompletion } from '@codemirror/autocomplete'
import { Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { applySnippet } from './completions/apply'
import { environments, snippet } from './completions/data/environments'

const BEGIN_BEFORE_CURSOR = /\\begin\{([^{}\s]+)\}$/

/** True when `\end{name}` closes the environment somewhere in `textAfter`. */
function isClosedAfter(textAfter: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tokens = new RegExp(`\\\\(begin|end)\\{${escaped}\\}`, 'g')
  let depth = 0
  for (const match of textAfter.matchAll(tokens)) {
    if (match[1] === 'begin') depth++
    else if (depth === 0) return true
    else depth--
  }
  return false
}

/**
 * Enter directly after a typed `\begin{name}` (rest of the line empty, not
 * already closed) expands the environment snippet, adding `\end{name}`.
 *
 * The completion list offers the same snippet, but upstream
 * @codemirror/autocomplete disables the list while a re-query is pending and
 * may briefly rank unrelated commands first, so fast typists would get a bare
 * newline or a wrong command (Overleaf's patched copy kept the previous list
 * enabled). An open list whose selected option is itself an environment
 * (`\begin{…}`) still decides.
 */
export function closeEnvironmentOnEnter(view: EditorView): boolean {
  const { state } = view
  if (
    completionStatus(state) === 'active' &&
    selectedCompletion(state)?.label.startsWith('\\begin{')
  ) {
    return false
  }
  if (state.readOnly || state.selection.ranges.length > 1) return false
  const { head, empty } = state.selection.main
  if (!empty) return false
  const line = state.doc.lineAt(head)
  if (state.sliceDoc(head, line.to).trim() !== '') return false
  const match = BEGIN_BEFORE_CURSOR.exec(state.sliceDoc(line.from, head))
  if (!match) return false
  const name = match[1]
  if (isClosedAfter(state.sliceDoc(head), name)) return false
  const from = head - match[0].length
  applySnippet(environments.get(name) ?? snippet(name))(
    view,
    { label: match[0] },
    from,
    head
  )
  return true
}

export const closeEnvironment = () =>
  Prec.high(keymap.of([{ key: 'Enter', run: closeEnvironmentOnEnter }]))
