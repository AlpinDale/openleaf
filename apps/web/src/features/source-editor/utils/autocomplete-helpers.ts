/**
 * Behaviour that Overleaf gets from its patched @codemirror/autocomplete,
 * rebuilt on the public API of the upstream package.
 */
import {
  type Completion,
  type CompletionResult,
  type CompletionSource,
  pickedCompletion,
} from '@codemirror/autocomplete'
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  Text,
  Transaction,
  codePointAt,
  codePointSize,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export type CompletionChange = {
  from: number
  to: number
  insert: string | Text
}

declare module '@codemirror/autocomplete' {
  interface Completion {
    /** Adjusts the change a picked completion makes (e.g. consume a `}`). */
    extend?: (state: EditorState, change: CompletionChange) => unknown
    deduplicate?: { key: string; priority: number }
  }
  interface CloseBracketConfig {
    /** Text to insert for an opening bracket; `open` alone means "don't close". */
    buildInsert?: (
      state: EditorState,
      range: SelectionRange,
      open: string,
      close: string
    ) => string
  }
}

// nextChar/prevChar: from @codemirror/autocomplete (MIT, Marijn Haverbeke)
export function nextChar(doc: Text, pos: number) {
  const next = doc.sliceString(pos, pos + 2)
  return next.slice(0, codePointSize(codePointAt(next, 0)))
}

export function prevChar(doc: Text, pos: number) {
  const prev = doc.sliceString(pos - 2, pos)
  return codePointSize(codePointAt(prev, 0)) === prev.length
    ? prev
    : prev.slice(1)
}

function applyExtended(completion: Completion) {
  const { apply, extend } = completion
  return (view: EditorView, picked: Completion, from: number, to: number) => {
    if (typeof apply === 'function') {
      // snippets: only widen the replaced range (Overleaf's patch also
      // re-adds a consumed brace after the snippet; that variant is skipped)
      const change: CompletionChange = { from, to, insert: '' }
      extend!(view.state, change)
      apply(view, picked, from, change.insert === '' ? change.to : to)
      return
    }
    const change: CompletionChange = {
      from,
      to,
      insert: apply ?? completion.label,
    }
    extend!(view.state, change)
    const insert =
      change.insert instanceof Text
        ? change.insert
        : view.state.toText(change.insert)
    view.dispatch({
      changes: { from: change.from, to: change.to, insert },
      selection: EditorSelection.cursor(change.from + insert.length),
      scrollIntoView: true,
      annotations: [
        pickedCompletion.of(picked),
        Transaction.userEvent.of('input.complete'),
      ],
    })
  }
}

/**
 * Keeps one option per `deduplicate.key` (or label), preferring the highest
 * `deduplicate.priority` — Overleaf's patched autocomplete did this across
 * options whose `detail` differs, which upstream keeps as duplicates.
 */
function deduplicate(options: readonly Completion[]): Completion[] {
  const byKey = new Map<string, Completion>()
  for (const option of options) {
    const key = option.deduplicate?.key ?? option.label
    const existing = byKey.get(key)
    if (
      !existing ||
      (option.deduplicate?.priority ?? 0) >
        (existing.deduplicate?.priority ?? 0)
    ) {
      byKey.set(key, option)
    }
  }
  return byKey.size === options.length ? [...options] : [...byKey.values()]
}

function normalizeResult(result: CompletionResult): CompletionResult {
  return {
    ...result,
    options: deduplicate(result.options).map(option =>
      option.extend ? { ...option, apply: applyExtended(option) } : option
    ),
  }
}

/** Honours `Completion.extend` and `deduplicate` on the options a source returns. */
export function supportExtend(source: CompletionSource): CompletionSource {
  return context => {
    const result = source(context)
    if (result instanceof Promise) {
      return result.then(value => value && normalizeResult(value))
    }
    return result && normalizeResult(result)
  }
}

const defaultCloseBefore = ')]}:;>'

/**
 * Applies a language's `closeBrackets.buildInsert` when typing an opening
 * bracket, before the upstream closeBrackets handler runs.
 */
export const buildInsertInputHandler = EditorView.inputHandler.of(
  (view, from, to, text) => {
    if (view.composing || view.state.readOnly) return false
    const { state } = view
    const config = state.languageDataAt<{
      brackets?: string[]
      before?: string
      buildInsert?: (
        state: EditorState,
        range: SelectionRange,
        open: string,
        close: string
      ) => string
    }>('closeBrackets', from)[0]
    if (!config?.buildInsert || !config.brackets?.includes(text)) return false
    const sel = state.selection
    if (sel.ranges.length > 1 || from !== sel.main.from || to !== sel.main.to)
      return false
    if (!sel.main.empty) return false
    const closeBefore = config.before ?? defaultCloseBefore
    const next = nextChar(state.doc, from)
    if (next && !/\s/.test(next) && !closeBefore.includes(next)) return false
    const close =
      text === '[' ? ']' : text === '{' ? '}' : text === '(' ? ')' : text
    if (next === close && text === close) return false
    const insert = config.buildInsert(state, sel.main, text, close)
    if (insert === text + close) return false
    view.dispatch({
      changes: { from, insert },
      selection: EditorSelection.cursor(from + text.length),
      userEvent: 'input.type',
      scrollIntoView: true,
    })
    return true
  }
)
