import type { ProjectDetails, ProjectTree } from '@openleaf/shared'
import classNames from 'classnames'
import { Link } from 'react-router'
import { AccountMenu } from '@/features/common/account-menu'
import {
  setFocusMode,
  useFocusModeStore,
} from '@/features/focus-mode/focus-mode-store'
import { ToolbarMenuBar } from '@/features/menu-bar/components/toolbar-menu-bar'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useEditorStore } from '../editor-store'
import { EditableProjectName } from './editable-project-name'
import { GitButton } from './git-dialog'
import { LayoutDropdown } from './layout-dropdown'

function ReviewButton() {
  const { t } = useTranslation()
  const reviewOpen = useEditorStore(s => s.reviewOpen)
  return (
    <OLButton
      variant="ghost"
      size="sm"
      className="ide-redesign-toolbar-button-subdued"
      leadingIcon="rate_review"
      active={reviewOpen}
      aria-pressed={reviewOpen}
      data-testid="review-button"
      onClick={() => useEditorStore.getState().toggleReview()}
    >
      {t('review')}
    </OLButton>
  )
}

function HistoryButton() {
  const { t } = useTranslation()
  const historyOpen = useEditorStore(s => s.historyOpen)
  return (
    <OLButton
      variant="ghost"
      size="sm"
      className="ide-redesign-toolbar-button-subdued"
      leadingIcon="history"
      active={historyOpen}
      aria-pressed={historyOpen}
      data-testid="history-button"
      onClick={() => useEditorStore.getState().setHistoryOpen(!historyOpen)}
    >
      {t('history')}
    </OLButton>
  )
}

function ExitFocusModeButton() {
  const { t } = useTranslation()
  return (
    <OLTooltip
      id="tooltip-exit-focus-mode"
      description={t('exit_focus_mode')}
      overlayProps={{ delay: 0, placement: 'bottom' }}
    >
      <OLIconButton
        icon="close_fullscreen"
        className="ide-redesign-toolbar-button-subdued ide-redesign-toolbar-button-icon"
        onClick={() => setFocusMode(false)}
        accessibilityLabel={t('exit_focus_mode')}
        data-testid="exit-focus-mode"
      />
    </OLTooltip>
  )
}

/**
 * Top bar. In focus mode only the project name and an exit control show;
 * the menu bar stays mounted (hidden) so its commands and dialogs keep
 * working from shortcuts and the command palette.
 */
export function EditorTopBar({
  project,
  tree,
}: {
  project: ProjectDetails
  tree: ProjectTree
}) {
  const { t } = useTranslation()
  const focusMode = useFocusModeStore(s => s.focusMode)
  return (
    <nav
      className={classNames('ide-redesign-toolbar', {
        'openleaf-focus-mode-toolbar': focusMode,
      })}
      aria-label={t('project_actions')}
      data-testid="editor-top-bar"
      data-focus-mode={focusMode}
    >
      <div className="ide-redesign-toolbar-menu">
        <div className="openleaf-toolbar-chrome" hidden={focusMode}>
          <OLTooltip
            id="back-to-projects"
            description={t('back_to_your_projects')}
            overlayProps={{ placement: 'bottom' }}
          >
            <Link
              to="/"
              className="ide-redesign-toolbar-home-button btn ide-redesign-toolbar-button-subdued ide-redesign-toolbar-button-icon openleaf-home-button"
              aria-label={t('back_to_your_projects')}
            >
              <MaterialIcon type="home" />
            </Link>
          </OLTooltip>
          <ToolbarMenuBar project={project} tree={tree} />
        </div>
      </div>
      <div className="openleaf-toolbar-title">
        <EditableProjectName project={project} readOnly={focusMode} />
      </div>
      <div className="ide-redesign-toolbar-actions-wrapper">
        <div className="ide-redesign-toolbar-actions">
          {focusMode ? (
            <div className="ide-redesign-toolbar-button-container">
              <ExitFocusModeButton />
            </div>
          ) : (
            <>
              <div className="ide-redesign-toolbar-button-container">
                <ReviewButton />
              </div>
              <div className="ide-redesign-toolbar-button-container">
                <HistoryButton />
              </div>
              <div className="ide-redesign-toolbar-button-container">
                <LayoutDropdown projectId={project.id} />
              </div>
              <div className="ide-redesign-toolbar-button-container">
                <GitButton project={project} />
              </div>
              <div className="ide-redesign-toolbar-button-container">
                <AccountMenu toggleClassName="ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued" />
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
