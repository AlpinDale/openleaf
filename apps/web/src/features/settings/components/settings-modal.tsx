// Adapted from Overleaf services/web/frontend/js/features/ide-settings/{components/settings-modal.tsx,components/settings-modal-body.tsx,context/settings-modal-context.tsx} (AGPL-3.0).
import {
  type ProjectDetails,
  type ProjectTree,
  roleAtLeast,
  type UserSettings,
} from '@openleaf/shared'
import {
  Nav,
  NavLink,
  TabContainer,
  TabContent,
  TabPane,
} from 'react-bootstrap'
import { useMe } from '@/api/auth'
import { DictionaryModal } from '@/features/dictionary/components/dictionary-modal'
import { useTranslation } from '@/i18n'
import MaterialIcon, {
  type AvailableUnfilledIcon,
} from '@/shared/components/material-icon'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import {
  closeSettingsModal,
  SETTINGS_TABS,
  type SettingsTab,
  setSettingsTab,
  useSettingsModalStore,
} from '../settings-modal-store'
import {
  AppearanceSettings,
  CompilerSettings,
  EditorSettings,
  ReferenceSettings,
  SpellingSettings,
} from './settings-tabs'

const TAB_ICONS: Record<SettingsTab, AvailableUnfilledIcon> = {
  editor: 'code',
  spelling_and_language: 'spellcheck',
  compiler: 'picture_as_pdf',
  references: 'book_5',
  appearance: 'brush',
}

function TabBody({
  tab,
  project,
  tree,
  settings,
}: {
  tab: SettingsTab
  project: ProjectDetails
  tree: ProjectTree
  settings: UserSettings
}) {
  const canWrite = roleAtLeast(project.role, 'editor')
  switch (tab) {
    case 'editor':
      return <EditorSettings settings={settings} />
    case 'spelling_and_language':
      return <SpellingSettings project={project} canWrite={canWrite} />
    case 'compiler':
      return (
        <CompilerSettings project={project} tree={tree} canWrite={canWrite} />
      )
    case 'references':
      return (
        <ReferenceSettings
          project={project}
          tree={tree}
          settings={settings}
          canWrite={canWrite}
        />
      )
    case 'appearance':
      return <AppearanceSettings settings={settings} />
  }
}

/** The editor's Settings window (rail Settings button, File → Settings). */
export function SettingsModal({
  project,
  tree,
}: {
  project: ProjectDetails
  tree: ProjectTree
}) {
  const { t } = useTranslation()
  const show = useSettingsModalStore(s => s.show)
  const activeTab = useSettingsModalStore(s => s.activeTab)
  const settings = useMe().data?.settings

  return (
    <>
      <OLModal
        show={show && Boolean(settings)}
        onHide={closeSettingsModal}
        size="lg"
        themed
        backdropClassName={
          activeTab === 'appearance'
            ? 'ide-settings-modal-transparent-backdrop'
            : undefined
        }
        data-testid="settings-modal"
      >
        <OLModalHeader>
          <OLModalTitle>{t('settings')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody className="ide-settings-modal-body">
          {settings && (
            <TabContainer
              transition={false}
              activeKey={activeTab}
              onSelect={key => {
                if (key) setSettingsTab(key as SettingsTab)
              }}
              id="ide-settings-tabs"
            >
              <div className="d-flex flex-row">
                <Nav
                  activeKey={activeTab}
                  className="d-flex flex-column ide-settings-tab-nav"
                >
                  {SETTINGS_TABS.map(tab => (
                    <NavLink
                      key={tab}
                      eventKey={tab}
                      className="ide-settings-tab-link ide-settings-tab-link-button"
                      as="button"
                      data-testid={`settings-tab-${tab}`}
                    >
                      <MaterialIcon
                        className="ide-settings-tab-link-icon"
                        type={TAB_ICONS[tab]}
                        unfilled
                      />
                      <span>{t(tab)}</span>
                      <div className="flex-grow-1" />
                    </NavLink>
                  ))}
                  <a
                    href="/settings"
                    target="_blank"
                    rel="noopener"
                    className="ide-settings-tab-link ide-settings-tab-link-anchor"
                  >
                    <MaterialIcon
                      className="ide-settings-tab-link-icon"
                      type="settings"
                      unfilled
                    />
                    <span>{t('account_settings')}</span>
                    <div className="flex-grow-1" />
                    <MaterialIcon
                      type="open_in_new"
                      className="ide-settings-tab-link-external"
                    />
                  </a>
                </Nav>
                <TabContent className="ide-settings-tab-content">
                  {SETTINGS_TABS.map(tab => (
                    <TabPane eventKey={tab} key={tab}>
                      {tab === activeTab && (
                        <TabBody
                          tab={tab}
                          project={project}
                          tree={tree}
                          settings={settings}
                        />
                      )}
                    </TabPane>
                  ))}
                </TabContent>
              </div>
            </TabContainer>
          )}
        </OLModalBody>
      </OLModal>
      <DictionaryModal />
    </>
  )
}
