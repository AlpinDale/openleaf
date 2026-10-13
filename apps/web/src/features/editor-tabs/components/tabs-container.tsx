// Adapted from Overleaf services/web/frontend/js/features/source-editor/components/tabs/tabs-container.tsx (AGPL-3.0)
import type { ProjectTree } from '@openleaf/shared'
import classNames from 'classnames'
import { throttle } from 'lodash'
import { useCallback, useMemo, useState } from 'react'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import { useTranslation } from '@/i18n'
import {
  makeTabPermanent,
  moveTab,
  setTabsContextMenuTarget,
  TAB_TRANSFER_TYPE,
} from '../tabs-store'
import {
  closeOtherTabs,
  closeTab,
  openTab,
  useActiveEntryId,
  useEditorTabs,
} from '../use-editor-tabs'
import { Tab } from './tab'
import { TabsContextMenu } from './tabs-context-menu'

/** The editor tab strip (user setting `editorTabs`). */
export function TabsContainer({
  projectId,
  tree,
  preview,
}: {
  projectId: string
  tree: ProjectTree
  preview: boolean
}) {
  const { t } = useTranslation()
  const tabs = useEditorTabs(projectId, tree, preview)
  const activeId = useActiveEntryId()
  const index = indexTree(tree)
  const [hovered, setHovered] = useState(false)

  const handleOpen = useCallback((id: string) => openTab(index, id), [index])
  const handleClose = useCallback((id: string) => closeTab(index, id), [index])
  const handleContextMenu = useCallback(
    (coords: { top: number; left: number }, tabId: string) =>
      setTabsContextMenuTarget({ ...coords, tabId }),
    []
  )
  const handleCloseContextMenu = useCallback(
    () => setTabsContextMenuTarget(null),
    []
  )

  const throttledDragOver = useMemo(
    () => throttle(() => setHovered(true), 50),
    []
  )

  // dropping past the last tab moves the tab to the end
  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(TAB_TRANSFER_TYPE)) return
      event.preventDefault()
      throttledDragOver()
    },
    [throttledDragOver]
  )
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      throttledDragOver.cancel()
      setHovered(false)
      const sourceId = event.dataTransfer.getData(TAB_TRANSFER_TYPE)
      const lastId = tabs[tabs.length - 1]?.id
      if (!sourceId || !lastId) return
      event.preventDefault()
      event.stopPropagation()
      moveTab(sourceId, lastId, 'right')
    },
    [tabs, throttledDragOver]
  )
  const handleDragLeave = useCallback(() => {
    throttledDragOver.cancel()
    setHovered(false)
  }, [throttledDragOver])

  // a vertical wheel scrolls the row horizontally
  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (event.deltaY !== 0 && event.deltaX === 0)
      event.currentTarget.scrollLeft += event.deltaY
  }, [])

  useCommandProvider(() => {
    if (tabs.length === 0 || !activeId) return
    return [
      {
        id: 'close-tab',
        label: t('close_tab'),
        disabled: tabs.length <= 1,
        handler: () => closeTab(index, activeId),
      },
      {
        id: 'close-other-tabs',
        label: t('close_other_tabs'),
        disabled: tabs.length <= 1,
        handler: () => closeOtherTabs(index, activeId),
      },
    ]
  }, [tabs.length, activeId, index, t])

  return (
    <div className="editor-tabs-container" data-testid="editor-tabs">
      <div
        className={classNames('editor-tabs-row', {
          'editor-tabs-row-hovered': hovered,
        })}
        role="tablist"
        tabIndex={-1}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        onWheel={handleWheel}
      >
        {tabs.map(tab => (
          <Tab
            key={tab.id}
            tab={tab}
            isSelected={tab.id === activeId}
            canCloseTab={tabs.length > 1}
            onOpen={handleOpen}
            onClose={handleClose}
            onMakePermanent={makeTabPermanent}
            onDrop={moveTab}
            onContextMenu={handleContextMenu}
            onCloseContextMenu={handleCloseContextMenu}
          />
        ))}
      </div>
      <TabsContextMenu tabs={tabs} index={index} />
    </div>
  )
}
