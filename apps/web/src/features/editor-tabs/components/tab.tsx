// Adapted from Overleaf services/web/frontend/js/features/source-editor/components/tabs/tab.tsx (AGPL-3.0)
import classNames from 'classnames'
import { throttle } from 'lodash'
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import FileTreeIcon from '@/features/file-tree/components/file-tree-icon'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import { TAB_TRANSFER_TYPE } from '../tabs-store'
import type { EditorTab } from '../use-editor-tabs'

type TabProps = {
  tab: EditorTab
  isSelected: boolean
  canCloseTab: boolean
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onMakePermanent: (id: string) => void
  onDrop: (sourceId: string, targetId: string, side: 'left' | 'right') => void
  onContextMenu: (coords: { top: number; left: number }, id: string) => void
  onCloseContextMenu: () => void
}

function sideOfTarget(element: Element, clientX: number): 'left' | 'right' {
  const rect = element.getBoundingClientRect()
  return rect.left + rect.width / 2 < clientX ? 'right' : 'left'
}

export const Tab = memo(function Tab({
  tab,
  isSelected,
  canCloseTab,
  onOpen,
  onClose,
  onMakePermanent,
  onDrop,
  onContextMenu,
  onCloseContextMenu,
}: TabProps) {
  const { t } = useTranslation()
  const tabRef = useRef<HTMLDivElement>(null)
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null)

  const throttledDragOver = useMemo(
    () =>
      throttle((element: Element, clientX: number) => {
        setDropSide(sideOfTarget(element, clientX))
      }, 50),
    []
  )

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.stopPropagation()
      event.dataTransfer.setData(TAB_TRANSFER_TYPE, tab.id)
      event.dataTransfer.effectAllowed = 'move'
    },
    [tab.id]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(TAB_TRANSFER_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      throttledDragOver(event.currentTarget, event.clientX)
    },
    [throttledDragOver]
  )

  const handleDragLeave = useCallback(
    (event: React.DragEvent) => {
      event.stopPropagation()
      if (event.currentTarget.contains(event.relatedTarget as Node | null))
        return
      throttledDragOver.cancel()
      setDropSide(null)
    },
    [throttledDragOver]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      throttledDragOver.cancel()
      setDropSide(null)
      const sourceId = event.dataTransfer.getData(TAB_TRANSFER_TYPE)
      if (!sourceId) return
      event.preventDefault()
      event.stopPropagation()
      onDrop(sourceId, tab.id, sideOfTarget(event.currentTarget, event.clientX))
    },
    [onDrop, tab.id, throttledDragOver]
  )

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button === 0) onOpen(tab.id)
    },
    [onOpen, tab.id]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') onOpen(tab.id)
    },
    [onOpen, tab.id]
  )

  const handleCloseClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onClose(tab.id)
    },
    [onClose, tab.id]
  )

  // middle-click closes
  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
      if (event.button === 1) {
        event.stopPropagation()
        onClose(tab.id)
      }
    },
    [onClose, tab.id]
  )

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey) {
        onCloseContextMenu()
        return
      }
      event.preventDefault()
      onContextMenu({ top: event.pageY, left: event.pageX }, tab.id)
    },
    [onContextMenu, onCloseContextMenu, tab.id]
  )

  useLayoutEffect(() => {
    if (isSelected)
      tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [isSelected])

  return (
    <div
      ref={tabRef}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDoubleClick={() => onMakePermanent(tab.id)}
      role="tab"
      aria-selected={isSelected}
      onClick={handleClick}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      data-tab-id={tab.id}
      tabIndex={0}
      className={classNames('editor-file-tab', {
        'tab-selected': isSelected,
        'tab-drop-left': dropSide === 'left',
        'tab-drop-right': dropSide === 'right',
        'tab-temporary': tab.lifetime === 'temporary',
      })}
    >
      <div className="editor-file-tab-content">
        <span className="editor-file-tab-icon">
          <FileTreeIcon isLinkedFile={tab.isLinkedFile} name={tab.name} />
        </span>
        <div className="editor-file-tab-path">&lrm;{tab.displayPath}</div>
        <div className="editor-file-tab-action">
          <button
            type="button"
            onClick={handleCloseClick}
            disabled={!canCloseTab}
            className="editor-file-tab-close-action"
            aria-label={t('close')}
          >
            <MaterialIcon type="close" />
          </button>
        </div>
      </div>
    </div>
  )
})
