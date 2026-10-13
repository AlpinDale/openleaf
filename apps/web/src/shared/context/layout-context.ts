import { useCallback } from 'react'
import {
  type EditorLayout,
  useEditorStore,
} from '@/features/editor/editor-store'
import { useFocusModeStore } from '@/features/focus-mode/focus-mode-store'

type IdeView = 'editor' | 'pdf'

/** Overleaf's layout context in terms of the OpenLeaf editor layout. */
export function useLayoutContext() {
  const layout = useEditorStore(s => s.layout)
  const focusMode = useFocusModeStore(s => s.focusMode)
  const setView = useCallback((view: IdeView) => {
    useEditorStore
      .getState()
      .setLayout(view === 'pdf' ? 'pdfOnly' : 'editorOnly')
  }, [])
  const changeLayout = useCallback((next: 'sideBySide' | 'flat') => {
    useEditorStore
      .getState()
      .setLayout(next === 'sideBySide' ? 'sideBySide' : 'editorOnly')
  }, [])
  return {
    pdfLayout: (layout === 'sideBySide' ? 'sideBySide' : 'flat') as
      | 'sideBySide'
      | 'flat',
    view: (layout === 'pdfOnly' ? 'pdf' : 'editor') as IdeView,
    detachRole: (layout === 'detached' ? 'detacher' : undefined) as
      | 'detacher'
      | undefined,
    focusMode,
    setView,
    changeLayout,
    layout: layout as EditorLayout,
  }
}
