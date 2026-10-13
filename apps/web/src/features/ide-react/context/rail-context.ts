import { useCallback } from 'react'
import { useEditorStore } from '@/features/editor/editor-store'

const TABS = { 'full-project-search': 'search', 'file-tree': 'files' } as const

export function useRailContext() {
  const openTab = useCallback((tab: keyof typeof TABS) => {
    useEditorStore.setState({ railTab: TABS[tab] })
  }, [])
  return { openTab }
}
