import { ReactNode } from 'react'
import { ToolbarButton } from './toolbar-button'
import { undo, redo } from '../../commands/undo'
import { useTranslation } from '@/i18n'
import { isMac } from '@/shared/utils/os'
import { useCodeMirrorStateContext } from '@/features/source-editor/components/codemirror-context'
import EditorSwitch from '@/features/source-editor/components/editor-switch'
import { ToggleSearchButton } from './toggle-search-button'
import SwitchToPDFButton from '../switch-to-pdf-button'
import ReviewModeSwitcher from '@/features/review/review-mode-switcher'

type ToolbarLayoutProps = {
  children: ReactNode
  className?: string
}

type ToolbarLayoutLeftProps = {
  children?: ReactNode
  canEdit?: boolean
  showActions?: boolean
}

type ToolbarLayoutRightProps = {
  canSearchInFile?: boolean
  children?: ReactNode
}

function Left({ children, canEdit }: ToolbarLayoutLeftProps) {
  const { t } = useTranslation()
  return (
    <div className="ol-toolbar-layout-left">
      {canEdit && (
        <div
          className="ol-editor-toolbar-button-group"
          aria-label={t('toolbar_undo_redo_actions')}
        >
          <ToolbarButton
            id="toolbar-undo"
            label={t('toolbar_undo')}
            command={undo}
            icon="undo"
            shortcut={isMac ? '⌘Z' : 'Ctrl+Z'}
          />
          <ToolbarButton
            id="toolbar-redo"
            label={t('toolbar_redo')}
            command={redo}
            icon="redo"
            shortcut={isMac ? '⇧⌘Z' : 'Ctrl+Y'}
          />
        </div>
      )}
      {children}
    </div>
  )
}

function Right({ canSearchInFile, children }: ToolbarLayoutRightProps) {
  const state = useCodeMirrorStateContext()
  return (
    <div className="ol-toolbar-layout-right">
      <EditorSwitch />
      <ReviewModeSwitcher />
      <div
        style={{
          display: 'flex',
          visibility: canSearchInFile ? 'visible' : 'hidden',
        }}
      >
        <ToggleSearchButton state={state} />
      </div>
      <SwitchToPDFButton />
      {children}
    </div>
  )
}

type ToolbarLayoutCompoundComponent = ((
  props: ToolbarLayoutProps
) => React.JSX.Element) & {
  Left: typeof Left
  Right: typeof Right
}

export const ToolbarLayout = (({ children, className }: ToolbarLayoutProps) => (
  <div className={className}>{children}</div>
)) as ToolbarLayoutCompoundComponent

ToolbarLayout.Left = Left
ToolbarLayout.Right = Right
