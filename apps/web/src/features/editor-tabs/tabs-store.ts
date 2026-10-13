// Tab state adapted from Overleaf services/web/frontend/js/features/ide-react/context/tabs-context.tsx (AGPL-3.0)
import { create } from 'zustand'

export type TabLifetime = 'permanent' | 'temporary'
export type OpenTab = { id: string; lifetime: TabLifetime }

/** Drag-and-drop data type carrying a tab's entry id. */
export const TAB_TRANSFER_TYPE = 'text/x.tab-id'

export type TabsContextMenuTarget = { top: number; left: number; tabId: string }

type TabsState = {
  projectId: string | null
  tabs: OpenTab[]
  contextMenuTarget: TabsContextMenuTarget | null
}

/** Open editor tabs of the current project, persisted in localStorage. */
export const useEditorTabsStore = create<TabsState>(() => ({
  projectId: null,
  tabs: [],
  contextMenuTarget: null,
}))

const storageKey = (projectId: string) => `openleaf:tabs:${projectId}`

function readStoredTabs(projectId: string): OpenTab[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(projectId)) ?? '[]'
    )
    if (!Array.isArray(value)) return []
    return value.filter(
      (tab): tab is OpenTab =>
        typeof tab?.id === 'string' &&
        (tab.lifetime === 'permanent' || tab.lifetime === 'temporary')
    )
  } catch {
    return []
  }
}

/** Replaces the tab list (no-op when `update` returns the same array) and persists it. */
function updateTabs(update: (tabs: OpenTab[]) => OpenTab[]) {
  const { projectId, tabs } = useEditorTabsStore.getState()
  const next = update(tabs)
  if (next === tabs) return
  useEditorTabsStore.setState({ tabs: next })
  if (projectId)
    localStorage.setItem(storageKey(projectId), JSON.stringify(next))
}

/** Loads the persisted tabs when the editor switches to `projectId`. */
export function loadTabs(projectId: string) {
  if (useEditorTabsStore.getState().projectId === projectId) return
  useEditorTabsStore.setState({
    projectId,
    tabs: readStoredTabs(projectId),
    contextMenuTarget: null,
  })
}

/**
 * Adds a tab for a newly opened entry. A temporary (preview) tab replaces the
 * existing preview tab in place; an already open entry keeps its tab.
 */
export function addTab(id: string, lifetime: TabLifetime) {
  updateTabs(tabs => {
    if (tabs.some(tab => tab.id === id)) return tabs
    const previewIndex = tabs.findIndex(tab => tab.lifetime === 'temporary')
    const tab = { id, lifetime }
    if (previewIndex === -1) return [...tabs, tab]
    // there is at most one preview tab
    const next = [...tabs]
    next[previewIndex] = tab
    return next
  })
}

export function makeTabPermanent(id: string) {
  updateTabs(tabs =>
    tabs.some(tab => tab.id === id && tab.lifetime === 'temporary')
      ? tabs.map(tab =>
          tab.id === id ? { ...tab, lifetime: 'permanent' } : tab
        )
      : tabs
  )
}

/** Keeps only the tabs for which `keep` holds. */
export function filterTabs(keep: (tab: OpenTab, index: number) => boolean) {
  updateTabs(tabs => {
    const next = tabs.filter(keep)
    return next.length === tabs.length ? tabs : next
  })
}

/** Moves a tab to the left or right of another (drag and drop). */
export function moveTab(
  sourceId: string,
  targetId: string,
  side: 'left' | 'right'
) {
  if (sourceId === targetId) return
  updateTabs(tabs => {
    const sourceIndex = tabs.findIndex(tab => tab.id === sourceId)
    const targetIndex = tabs.findIndex(tab => tab.id === targetId)
    if (sourceIndex === -1 || targetIndex === -1) return tabs
    const next = [...tabs]
    const [moved] = next.splice(sourceIndex, 1)
    let index = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    if (side === 'right') index++
    next.splice(index, 0, moved)
    return next.every((tab, i) => tab === tabs[i]) ? tabs : next
  })
}

export function setTabsContextMenuTarget(target: TabsContextMenuTarget | null) {
  useEditorTabsStore.setState({ contextMenuTarget: target })
}
