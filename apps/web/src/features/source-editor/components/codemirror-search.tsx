import { createPortal } from 'react-dom'
import { searchPanelOpen } from '@codemirror/search'
import CodeMirrorSearchForm from './codemirror-search-form'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from './codemirror-context'

function CodeMirrorSearch() {
  const view = useCodeMirrorViewContext()
  const state = useCodeMirrorStateContext()

  // the panel element created by the `search` extension's createPanel
  const panel = searchPanelOpen(state)
    ? view.dom.querySelector<HTMLElement>('.ol-cm-search')
    : null

  if (!panel) {
    return null
  }

  return createPortal(<CodeMirrorSearchForm />, panel)
}

export default CodeMirrorSearch
