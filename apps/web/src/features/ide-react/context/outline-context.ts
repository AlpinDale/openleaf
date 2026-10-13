import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import { useEditorStore } from '@/features/editor/editor-store'
import localStorage from '@/infrastructure/local-storage'
import { isValidTeXFile } from '@/main/is-valid-tex-file'
import { useEditorOpenDocContext } from './editor-open-doc-context'

export type PartialFlatOutline = {
  level: number
  title: string
  line: number
}[]

export type FlatOutlineState =
  | {
      items: PartialFlatOutline
      partial: boolean
    }
  | undefined

const EXPANDED_KEY = 'openleaf:outline-expanded'

/** Shared between the editor (which computes the outline) and the outline pane. */
const useOutlineStore = create<{
  flatOutline: FlatOutlineState
  currentLine: number
  outlineExpanded: boolean
}>(() => ({
  flatOutline: undefined,
  currentLine: -1,
  outlineExpanded: localStorage.getItem(EXPANDED_KEY) !== false,
}))

const setFlatOutline = (
  value: FlatOutlineState | ((prev: FlatOutlineState) => FlatOutlineState)
) =>
  useOutlineStore.setState(state => ({
    flatOutline: typeof value === 'function' ? value(state.flatOutline) : value,
  }))

// the outline follows the cursor and the scroll position of the editor
window.addEventListener('cursor:editor:update', event => {
  const { row } = (event as CustomEvent<{ row: number }>).detail
  useOutlineStore.setState({ currentLine: row + 1 })
})
window.addEventListener('scroll:editor:update', event => {
  useOutlineStore.setState({
    currentLine: (event as CustomEvent<number>).detail,
  })
})

const setExpanded = (outlineExpanded: boolean) => {
  localStorage.setItem(EXPANDED_KEY, outlineExpanded)
  useOutlineStore.setState({ outlineExpanded })
}

const closestSectionLineNumber = (
  outline: { line: number }[] | undefined,
  lineNumber: number
): number => {
  if (!outline) return -1
  let highestLine = -1
  for (const section of outline) {
    if (section.line > lineNumber) return highestLine
    highestLine = section.line
  }
  return highestLine
}

export const useOutlineContext = () => {
  const { flatOutline, currentLine, outlineExpanded } = useOutlineStore()
  const { openDocName } = useEditorOpenDocContext()
  const fileOpen = useEditorStore(s => s.openFileId !== null)
  const canShowOutline =
    !fileOpen && !!openDocName && isValidTeXFile(openDocName)

  const highlightedLine = useMemo(
    () => closestSectionLineNumber(flatOutline?.items, currentLine),
    [flatOutline, currentLine]
  )

  const jumpToLine = useCallback((lineNumber: number, syncToPdf: boolean) => {
    window.dispatchEvent(
      new CustomEvent('editor:gotoLine', {
        detail: { gotoLine: lineNumber, gotoColumn: 0, syncToPdf },
      })
    )
  }, [])

  return {
    flatOutline,
    setFlatOutline,
    highlightedLine,
    jumpToLine,
    canShowOutline,
    outlineExpanded,
    toggleOutlineExpanded: () => setExpanded(!outlineExpanded),
    expandOutline: () => setExpanded(true),
    collapseOutline: () => setExpanded(false),
  }
}
