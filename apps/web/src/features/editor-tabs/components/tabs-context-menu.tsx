// Adapted from Overleaf services/web/frontend/js/features/source-editor/components/tabs/tabs-context-menu.tsx (AGPL-3.0)
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { TreeIndex } from '@/features/file-tree/util/tree-index'
import { openSettingsModal } from '@/features/settings/settings-modal-store'
import { useTranslation } from '@/i18n'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownItem,
  OLDropdownMenu,
} from '@/shared/components/ol/ol-dropdown-menu'
import { setTabsContextMenuTarget, useEditorTabsStore } from '../tabs-store'
import type { EditorTab } from '../use-editor-tabs'
import { closeOtherTabs, closeTab, closeTabsToRight } from '../use-editor-tabs'

export function TabsContextMenu({
  tabs,
  index,
}: {
  tabs: EditorTab[]
  index: TreeIndex
}) {
  const { t } = useTranslation()
  const target = useEditorTabsStore(s => s.contextMenuTarget)
  const menuRef = useRef<HTMLDivElement>(null)

  // close on a right-click elsewhere; right-clicking another tab re-targets it
  useEffect(() => {
    if (!target) return
    const handler = (event: MouseEvent) => {
      if (event.button !== 2) return
      const element = event.target as Element | null
      if (element?.closest('.context-menu, .editor-file-tab')) return
      setTabsContextMenuTarget(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [target])

  // focus the menu on open, and the originating tab on close
  const lastTabId = useRef<string | null>(null)
  useEffect(() => {
    if (target) {
      lastTabId.current = target.tabId
      menuRef.current?.querySelector<HTMLElement>('[role="menu"]')?.focus()
    } else if (lastTabId.current) {
      document
        .querySelector<HTMLElement>(`[data-tab-id="${lastTabId.current}"]`)
        ?.focus()
      lastTabId.current = null
    }
  }, [target])

  if (!target) return null

  const close = () => setTabsContextMenuTarget(null)
  const run = (action: () => void) => () => {
    action()
    close()
  }

  return createPortal(
    <div
      ref={menuRef}
      style={{ top: target.top, left: target.left }}
      className="context-menu"
    >
      <OLDropdown
        show
        drop="down"
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key === 'Tab' || event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        onToggle={(wantOpen: boolean) => {
          if (!wantOpen) close()
        }}
      >
        <OLDropdownMenu className="dropdown-menu-sm-width" tabIndex={-1}>
          <OLDropdownItem
            disabled={tabs.length <= 1}
            as="button"
            onClick={run(() => closeTab(index, target.tabId))}
          >
            {t('close')}
          </OLDropdownItem>
          <OLDropdownItem
            disabled={tabs.length <= 1}
            as="button"
            onClick={run(() => closeOtherTabs(index, target.tabId))}
          >
            {t('close_other_tabs')}
          </OLDropdownItem>
          <OLDropdownItem
            disabled={tabs[tabs.length - 1]?.id === target.tabId}
            as="button"
            onClick={run(() => closeTabsToRight(index, target.tabId))}
          >
            {t('close_tabs_to_the_right')}
          </OLDropdownItem>
          <OLDropdownDivider />
          <OLDropdownItem
            as="button"
            leadingIcon="settings"
            onClick={run(() => openSettingsModal('editor'))}
          >
            {t('tab_settings')}
          </OLDropdownItem>
        </OLDropdownMenu>
      </OLDropdown>
    </div>,
    document.body
  )
}
