import { EditorView } from '@codemirror/view'
import { EditorSelection, EditorState, StateCommand } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'

export { selectNextOccurrence } from '@codemirror/search'

/** The last match before `before`, wrapping around to the end of the doc. */
const lastMatch = (
  query: SearchQuery,
  state: EditorState,
  from: number,
  to: number,
  before: number
) => {
  let found: { from: number; to: number } | null = null
  const cursor = query.getCursor(state.doc, from, to)
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    if (result.value.to <= before) found = result.value
  }
  return found
}

const findPrevOccurence = (state: EditorState, search: string) => {
  const query = new SearchQuery({ search, literal: true })
  const { from, to } = state.selection.main
  return (
    lastMatch(query, state, 0, from, from) ??
    lastMatch(query, state, to, state.doc.length, state.doc.length)
  )
}

/** Selects the word around each empty selection range. */
const selectWord: StateCommand = ({ state, dispatch }) => {
  const selection = EditorSelection.create(
    state.selection.ranges.map(
      range => state.wordAt(range.head) ?? EditorSelection.cursor(range.head)
    ),
    state.selection.mainIndex
  )
  if (selection.eq(state.selection)) return false
  dispatch(state.update({ selection }))
  return true
}

export const selectPrevOccurrence: StateCommand = ({ state, dispatch }) => {
  const { ranges } = state.selection

  if (ranges.some(range => range.from === range.to)) {
    return selectWord({ state, dispatch })
  }

  const searchedText = state.sliceDoc(ranges[0].from, ranges[0].to)

  if (
    state.selection.ranges.some(
      range => state.sliceDoc(range.from, range.to) !== searchedText
    )
  ) {
    return false
  }

  const range = findPrevOccurence(state, searchedText)
  if (!range) {
    return false
  }

  dispatch(
    state.update({
      selection: state.selection.addRange(
        EditorSelection.range(range.from, range.to)
      ),
      effects: EditorView.scrollIntoView(range.to),
    })
  )

  return true
}
