import { useCallback } from 'react'
import { patchMe } from '@/api/auth'
import { useEditorStore } from '@/features/editor/editor-store'

/** Visual mode lives in the editor store and is persisted as `UserSettings.editorMode`. */
export function setVisualMode(visual: boolean) {
  const mode = visual ? 'visual' : 'source'
  useEditorStore.getState().setEditorMode(mode)
  patchMe({ settings: { editorMode: mode } }).catch(() => {})
}

export function useEditorPropertiesContext() {
  const showVisual = useEditorStore(s => s.editorMode === 'visual')
  const showSymbolPalette = useEditorStore(s => s.railTab === 'symbols')
  const toggleSymbolPalette = useCallback(
    () => useEditorStore.getState().setRailTab('symbols'),
    []
  )
  return {
    showVisual,
    setShowVisual: setVisualMode,
    showSymbolPalette,
    toggleSymbolPalette,
    // track changes arrive with M7
    trackChanges: false,
    wantTrackChanges: false,
  }
}
