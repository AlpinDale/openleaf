// Adapted from Overleaf services/web/frontend/js/features/ide-react/components/toolbar/change-layout-options.tsx (AGPL-3.0).
import {
  setFocusMode,
  useFocusModeStore,
} from '@/features/focus-mode/focus-mode-store'
import {
  formatShortcut,
  useCommandRegistryStore,
} from '@/features/ide-react/context/command-registry-context'
import { openDetachedPdf } from '@/features/pdf-preview/compile-store'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownHeader,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import { isMac } from '@/shared/utils/os'
import { type EditorLayout, useEditorStore } from '../editor-store'

export const LAYOUT_OPTIONS: {
  layout: EditorLayout
  icon: string
  labelKey: string
  /** Command registry id (also the key of its shortcut). */
  commandId: string
}[] = [
  {
    layout: 'sideBySide',
    icon: 'splitscreen_right',
    labelKey: 'split_view',
    commandId: 'change-layout-side-by-side',
  },
  {
    layout: 'editorOnly',
    icon: 'edit',
    labelKey: 'editor_only',
    commandId: 'change-layout-editor-only',
  },
  {
    layout: 'pdfOnly',
    icon: 'picture_as_pdf',
    labelKey: 'pdf_only',
    commandId: 'change-layout-pdf-only',
  },
  {
    layout: 'detached',
    icon: 'open_in_new',
    labelKey: 'open_pdf_in_separate_tab',
    commandId: 'change-layout-detached-pdf',
  },
]

export const FOCUS_MODE_COMMAND_ID = 'change-layout-focus-mode'

/** Switches the layout; "PDF in a separate tab" opens that tab (call from a user gesture). */
export function selectLayout(projectId: string, layout: EditorLayout) {
  if (layout === 'detached') openDetachedPdf(projectId)
  else useEditorStore.getState().setLayout(layout)
}

/** The formatted shortcut of a registry command, if it has one. */
export function useShortcutLabel(commandId: string): string | undefined {
  const shortcut = useCommandRegistryStore(s => s.shortcuts[commandId]?.[0])
  return shortcut ? formatShortcut(shortcut) : undefined
}

function ShortcutHint({ commandId }: { commandId: string }) {
  const label = useShortcutLabel(commandId)
  return label ? <span className="dropdown-shortcut">{label}</span> : null
}

export function LayoutDropdown({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const layout = useEditorStore(s => s.layout)
  const focusMode = useFocusModeStore(s => s.focusMode)

  return (
    <OLDropdown align="end">
      <OLDropdownToggle
        id="layout-dropdown-toggle"
        variant="ghost"
        size="sm"
        className="ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued"
        data-testid="layout-dropdown"
      >
        <MaterialIcon type="dock_to_right" className="me-1" />
        {t('layout')}
      </OLDropdownToggle>
      <OLDropdownMenu>
        <OLDropdownHeader>{t('layout_options')}</OLDropdownHeader>
        {LAYOUT_OPTIONS.map(option => (
          <OLDropdownItem
            key={option.layout}
            as="button"
            active={layout === option.layout}
            aria-current={layout === option.layout}
            leadingIcon={layout === option.layout ? 'check' : option.icon}
            trailingIcon={<ShortcutHint commandId={option.commandId} />}
            className={isMac ? 'dropdown-item-wide' : undefined}
            onClick={() => selectLayout(projectId, option.layout)}
            data-testid={`layout-${option.layout}`}
          >
            {t(option.labelKey)}
          </OLDropdownItem>
        ))}
        <OLDropdownDivider />
        <OLDropdownItem
          as="button"
          active={focusMode}
          aria-current={focusMode}
          leadingIcon={focusMode ? 'check' : 'crop_free'}
          trailingIcon={<ShortcutHint commandId={FOCUS_MODE_COMMAND_ID} />}
          className={isMac ? 'dropdown-item-wide' : undefined}
          onClick={() => setFocusMode(!focusMode)}
          data-testid="layout-focus-mode"
        >
          {t('focus_mode')}
        </OLDropdownItem>
      </OLDropdownMenu>
    </OLDropdown>
  )
}
