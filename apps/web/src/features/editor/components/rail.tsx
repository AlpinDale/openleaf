import type { ProjectDetails, ProjectTree } from '@openleaf/shared'
import classNames from 'classnames'
import type { ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { FileTreePanel } from '@/features/file-tree/components/file-tree-panel'
import { useCommandRegistryStore } from '@/features/ide-react/context/command-registry-context'
import { openSettingsModal } from '@/features/settings/settings-modal-store'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { type RailTab, useEditorStore } from '../editor-store'

const RAIL_TABS: { tab: RailTab; icon: string; titleKey: string }[] = [
  { tab: 'files', icon: 'description', titleKey: 'file_tree' },
  { tab: 'search', icon: 'search', titleKey: 'project_search' },
  { tab: 'symbols', icon: 'functions', titleKey: 'symbol_palette' },
]

/** Runs a registry command (registered by the menu bar). */
function runCommand(id: string) {
  useCommandRegistryStore
    .getState()
    .registry.get(id)
    ?.handler?.({ location: 'rail' })
}

// Adapted from Overleaf services/web/frontend/js/features/ide-react/components/rail/{rail-help-dropdown,rail-action-element}.tsx (AGPL-3.0).
function RailHelpDropdown() {
  const { t } = useTranslation()
  const hasContactUs = useCommandRegistryStore(s =>
    s.registry.has('contact-us')
  )
  return (
    <OLDropdown align="end" drop="end">
      <OLTooltip
        id="rail-dropdown-tooltip-help"
        description={t('help')}
        overlayProps={{ delay: 0, placement: 'right' }}
      >
        <span>
          <OLDropdownToggle
            id="rail-dropdown-btn-help"
            className="ide-rail-tab-link ide-rail-tab-button ide-rail-tab-dropdown"
            as="button"
            aria-label={t('help')}
            data-testid="rail-help"
          >
            <MaterialIcon
              className="ide-rail-tab-link-icon"
              type="help"
              unfilled
            />
          </OLDropdownToggle>
        </span>
      </OLTooltip>
      <OLDropdownMenu>
        <OLDropdownItem
          as="button"
          onClick={() => runCommand('keyboard-shortcuts')}
        >
          {t('keyboard_shortcuts')}
        </OLDropdownItem>
        {hasContactUs && (
          <>
            <OLDropdownDivider />
            <OLDropdownItem
              as="button"
              onClick={() => runCommand('contact-us')}
            >
              {t('contact_us')}
            </OLDropdownItem>
          </>
        )}
      </OLDropdownMenu>
    </OLDropdown>
  )
}

/** Icon strip; clicking the open tab collapses the rail panel. */
export function RailStrip() {
  const { t } = useTranslation()
  const railTab = useEditorStore(s => s.railTab)
  const setRailTab = useEditorStore(s => s.setRailTab)
  return (
    <nav className="ide-rail" aria-label={t('sidebar')}>
      <div className="ide-rail-tabs-nav">
        <div className="ide-rail-tabs-wrapper" role="tablist">
          {RAIL_TABS.map(({ tab, icon, titleKey }) => {
            const open = railTab === tab
            return (
              <OLTooltip
                key={tab}
                id={`rail-tab-tooltip-${tab}`}
                description={t(titleKey)}
                overlayProps={{ delay: 0, placement: 'right' }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={open}
                  aria-label={t(titleKey)}
                  className={classNames(
                    'ide-rail-tab-link ide-rail-tab-button',
                    {
                      'open-rail': open,
                    }
                  )}
                  onClick={() => setRailTab(tab)}
                  data-testid={`rail-tab-${tab}`}
                >
                  <MaterialIcon
                    type={icon}
                    className={classNames('ide-rail-tab-link-icon', {
                      unfilled: !open,
                    })}
                  />
                </button>
              </OLTooltip>
            )
          })}
        </div>
        <nav
          className="ide-rail-actions"
          aria-label={t('help_editor_settings')}
        >
          <RailHelpDropdown />
          <OLTooltip
            id="rail-tab-tooltip-settings"
            description={t('settings')}
            overlayProps={{ delay: 0, placement: 'right' }}
          >
            <button
              type="button"
              className="ide-rail-tab-link ide-rail-tab-button"
              aria-label={t('settings')}
              onClick={() => openSettingsModal()}
              data-testid="rail-tab-settings"
            >
              <MaterialIcon
                className="ide-rail-tab-link-icon"
                type="settings"
                unfilled
              />
            </button>
          </OLTooltip>
        </nav>
      </div>
    </nav>
  )
}

export function RailPanelHeader({
  title,
  actions,
}: {
  title: ReactNode
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const setRailTab = useEditorStore(s => s.setRailTab)
  return (
    <div className="rail-panel-header">
      <h4 className="rail-panel-title">{title}</h4>
      <div className="rail-panel-header-actions">
        {actions}
        <OLIconButton
          onClick={() => setRailTab(null)}
          className="rail-panel-header-button-subdued"
          icon="close"
          accessibilityLabel={t('close')}
          size="sm"
        />
      </div>
    </div>
  )
}

/**
 * Files tab: the file tree, plus an optional lower region (the outline) in a
 * vertical split.
 */
export function FilesRailPanel({
  project,
  tree,
  lower,
}: {
  project: ProjectDetails
  tree: ProjectTree
  lower?: ReactNode
}) {
  const { t } = useTranslation()
  const fileTree = <FileTreePanel project={project} tree={tree} />
  return (
    <div className="openleaf-rail-panel" data-testid="rail-panel-files">
      <RailPanelHeader title={t('file_tree')} />
      <div className="openleaf-rail-panel-body">
        {lower ? (
          <Group orientation="vertical" id="openleaf-rail-files">
            <Panel id="files" defaultSize="65" minSize="20">
              {fileTree}
            </Panel>
            <Separator className="vertical-resize-handle vertical-resize-handle-enabled" />
            <Panel id="lower" defaultSize="35" minSize="10">
              {lower}
            </Panel>
          </Group>
        ) : (
          fileTree
        )}
      </div>
    </div>
  )
}
