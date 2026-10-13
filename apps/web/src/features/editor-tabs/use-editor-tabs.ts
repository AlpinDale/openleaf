import type { ProjectTree } from '@openleaf/shared'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useEditorStore } from '@/features/editor/editor-store'
import { indexTree, type TreeIndex } from '@/features/file-tree/util/tree-index'
import {
  TAB_USER_EDIT_EVENT,
  tabsEvents,
} from '@/features/source-editor/extensions/tabs-listener'
import { disambiguatePaths } from './disambiguate-paths'
import {
  addTab,
  filterTabs,
  loadTabs,
  makeTabPermanent,
  useEditorTabsStore,
} from './tabs-store'

export type EditorTab = {
  id: string
  name: string
  displayPath: string
  isLinkedFile: boolean
  lifetime: 'permanent' | 'temporary'
}

/** The entry shown in the editor panel: a binary file over the doc beneath it. */
export function useActiveEntryId() {
  return useEditorStore(s => s.openFileId ?? s.openDocId)
}

/** Shows an entry in the editor panel; switching to a doc is `openDoc`. */
export function openTab(index: TreeIndex, id: string) {
  const kind = index.byId.get(id)?.kind
  const store = useEditorStore.getState()
  if (kind === 'doc') store.openDoc(id)
  else if (kind === 'file') store.openFile(id)
}

/** Closes a tab, first switching to its neighbour when it's the active one. */
export function closeTab(index: TreeIndex, id: string) {
  const { tabs } = useEditorTabsStore.getState()
  if (tabs.length <= 1) return
  const { openFileId, openDocId } = useEditorStore.getState()
  if (id === (openFileId ?? openDocId)) {
    const position = tabs.findIndex(tab => tab.id === id)
    const next = tabs[position + 1] ?? tabs[position - 1]
    if (next) openTab(index, next.id)
  }
  filterTabs(tab => tab.id !== id)
}

export function closeOtherTabs(index: TreeIndex, id: string) {
  const { openFileId, openDocId } = useEditorStore.getState()
  if (id !== (openFileId ?? openDocId)) openTab(index, id)
  filterTabs(tab => tab.id === id)
}

export function closeTabsToRight(index: TreeIndex, id: string) {
  const { tabs } = useEditorTabsStore.getState()
  const position = tabs.findIndex(tab => tab.id === id)
  if (position === -1) return
  const { openFileId, openDocId } = useEditorStore.getState()
  const activePosition = tabs.findIndex(
    tab => tab.id === (openFileId ?? openDocId)
  )
  if (activePosition === -1 || activePosition > position) openTab(index, id)
  filterTabs((_tab, i) => i <= position)
}

/**
 * Keeps the tab list in step with the editor: every opened entry gets a tab
 * (a preview tab when `preview`), local edits pin the preview tab, and tabs of
 * deleted entries close. Returns the tabs to render.
 */
export function useEditorTabs(
  projectId: string,
  tree: ProjectTree,
  preview: boolean
): EditorTab[] {
  useLayoutEffect(() => loadTabs(projectId), [projectId])

  const activeId = useActiveEntryId()
  const index = indexTree(tree)

  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs follow the opened entry, not later setting changes
  useEffect(() => {
    if (activeId && index.byId.has(activeId))
      addTab(activeId, preview ? 'temporary' : 'permanent')
  }, [activeId, index])

  useEffect(() => {
    filterTabs(tab => {
      const kind = index.byId.get(tab.id)?.kind
      return kind === 'doc' || kind === 'file'
    })
  }, [index])

  useEffect(() => {
    const pin = () => {
      const { openDocId, openFileId } = useEditorStore.getState()
      if (openDocId && !openFileId) makeTabPermanent(openDocId)
    }
    tabsEvents.addEventListener(TAB_USER_EDIT_EVENT, pin)
    return () => tabsEvents.removeEventListener(TAB_USER_EDIT_EVENT, pin)
  }, [])

  const openTabs = useEditorTabsStore(s => s.tabs)
  return useMemo(() => {
    const present = openTabs.filter(tab => index.byId.has(tab.id))
    const displayPaths = disambiguatePaths(
      present.map(tab => index.paths.get(tab.id) ?? '')
    )
    return present.map((tab, i) => {
      const entry = index.byId.get(tab.id)
      return {
        id: tab.id,
        name: entry?.name ?? '',
        displayPath: displayPaths[i],
        isLinkedFile: !!entry?.sourceUrl,
        lifetime: tab.lifetime,
      }
    })
  }, [openTabs, index])
}
