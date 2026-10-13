import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  OLDropdown,
  OLDropdownMenu,
} from '@/shared/components/ol/ol-dropdown-menu'

export type MenuCoords = { top: number; left: number }

/** Dropdown menu opened at the pointer (Overleaf's file-tree context menu pattern). */
export function FileTreeContextMenu({
  coords,
  onClose,
  children,
}: {
  coords: MenuCoords
  onClose: () => void
  children: ReactNode
}) {
  const dropUp =
    document.body.offsetHeight / coords.top < 2 &&
    document.body.offsetHeight - coords.top < 250

  return createPortal(
    <div style={coords} className="context-menu">
      <OLDropdown
        show
        drop={dropUp ? 'up' : 'down'}
        onToggle={wantOpen => {
          if (!wantOpen) onClose()
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <OLDropdownMenu
          className={dropUp ? 'context-menu-upwards' : undefined}
          id="dropdown-file-tree-context-menu"
          data-testid="file-tree-context-menu"
        >
          {children}
        </OLDropdownMenu>
      </OLDropdown>
    </div>,
    document.body
  )
}
