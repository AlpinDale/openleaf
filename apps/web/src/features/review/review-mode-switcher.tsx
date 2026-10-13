// Adapted from Overleaf services/web/frontend/js/features/review-panel/components/review-mode-switcher.tsx (AGPL-3.0)
import classNames from 'classnames'
import { forwardRef, type MouseEventHandler, memo } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useTranslation } from '@/i18n'
import DropdownMenuItem from '@/shared/components/dropdown/dropdown-menu-item'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import {
  type EditingMode,
  setEditingMode,
  useEditingMode,
} from './editing-mode'

const MODE_ICON: Record<EditingMode, string> = {
  editing: 'edit',
  reviewing: 'rate_review',
  viewing: 'visibility',
}

function ReviewModeDropdownItems() {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()
  const { mode, availableModes, disabledModes } = useEditingMode()
  const description: Record<EditingMode, string> = {
    editing: disabledModes.includes('editing')
      ? t('track_changes_is_on_for_everyone')
      : t('edit_content_directly'),
    reviewing: t('edits_become_suggestions'),
    viewing: t('can_view_content'),
  }

  return (
    <>
      {availableModes.map(item => (
        <DropdownMenuItem
          key={item}
          data-testid={`editing-mode-${item}`}
          disabled={disabledModes.includes(item)}
          onClick={() => {
            setEditingMode(item)
            view.focus()
          }}
          description={description[item]}
          leadingIcon={MODE_ICON[item]}
          active={mode === item}
        >
          {t(item)}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** Editing / Reviewing / Viewing switch on the editor toolbar. */
function ReviewModeSwitcher() {
  return (
    <OLDropdown className="review-mode-switcher" align="end">
      <OLDropdownToggle
        as={ModeSwitcherToggleButton}
        id="review-mode-switcher"
      />
      <OLDropdownMenu
        flip={false}
        popperConfig={{ strategy: 'fixed' }}
        // in the DOM from mount so Popper positions it inside the toolbar
        renderOnMount
      >
        <ReviewModeDropdownItems />
      </OLDropdownMenu>
    </OLDropdown>
  )
}

const ModeSwitcherToggleButton = forwardRef<
  HTMLButtonElement,
  { onClick: MouseEventHandler<HTMLButtonElement>; 'aria-expanded': boolean }
>(({ onClick, 'aria-expanded': ariaExpanded }, ref) => {
  const { t } = useTranslation()
  const { mode } = useEditingMode()
  return (
    <button
      type="button"
      className={classNames('review-mode-switcher-toggle-button', mode)}
      ref={ref}
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-label={t(mode)}
      data-testid="review-mode-switcher"
      data-mode={mode}
    >
      <MaterialIcon type={MODE_ICON[mode]} />
      <div className="review-mode-switcher-toggle-label">{t(mode)}</div>
      <MaterialIcon type="keyboard_arrow_down" />
    </button>
  )
})
ModeSwitcherToggleButton.displayName = 'ModeSwitcherToggleButton'

export default memo(ReviewModeSwitcher)
