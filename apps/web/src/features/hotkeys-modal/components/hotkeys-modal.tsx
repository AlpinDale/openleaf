// Adapted from Overleaf services/web/frontend/js/features/hotkeys-modal/components/hotkeys-modal.tsx (AGPL-3.0).
// OpenLeaf adds Mod-S (compile) and Mod-Shift-F (project search), and drops the
// link to Overleaf's online shortcut list.
import { memo } from 'react'
import { Trans, useTranslation } from '@/i18n'
import OLButton from '@/shared/components/ol/ol-button'
import OLCol from '@/shared/components/ol/ol-col'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLRow from '@/shared/components/ol/ol-row'

function Hotkey({
  combination,
  description,
}: {
  combination: string
  description: string
}) {
  return (
    <div className="hotkey" data-test-selector="hotkey">
      <span className="combination">{combination}</span>
      <span className="description">{description}</span>
    </div>
  )
}

export default memo(function HotkeysModal({
  handleHide,
  show,
  isMac = false,
  trackChangesVisible = false,
}: {
  handleHide: () => void
  show: boolean
  isMac?: boolean
  trackChangesVisible?: boolean
}) {
  const { t } = useTranslation()
  const ctrl = isMac ? 'Cmd' : 'Ctrl'

  return (
    <OLModal
      size="lg"
      onHide={handleHide}
      show={show}
      themed
      data-testid="hotkeys-modal"
    >
      <OLModalHeader>
        <OLModalTitle>{t('hotkeys')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody className="hotkeys-modal">
        <h3>{t('common')}</h3>

        <OLRow>
          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + F`}
              description={t('hotkey_find_and_replace')}
            />
            <Hotkey
              combination={`${ctrl} + Enter`}
              description={t('hotkey_compile')}
            />
            <Hotkey
              combination={`${ctrl} + S`}
              description={t('hotkey_compile')}
            />
          </OLCol>
          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + Z`}
              description={t('hotkey_undo')}
            />
            <Hotkey
              combination={`${ctrl} + Shift + F`}
              description={t('search_all_project_files')}
            />
          </OLCol>
          <OLCol xs={4}>
            <Hotkey
              combination={isMac ? `${ctrl} + Shift + Z` : `${ctrl} + Y`}
              description={t('hotkey_redo')}
            />
          </OLCol>
        </OLRow>

        <h3>{t('navigation')}</h3>

        <OLRow>
          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + Home`}
              description={t('hotkey_beginning_of_document')}
            />
          </OLCol>
          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + End`}
              description={t('hotkey_end_of_document')}
            />
          </OLCol>
          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + Shift + L`}
              description={t('hotkey_go_to_line')}
            />
          </OLCol>
        </OLRow>

        <h3>{t('editing')}</h3>

        <OLRow>
          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + /`}
              description={t('hotkey_toggle_comment')}
            />
            <Hotkey
              combination={`${ctrl} + D`}
              description={t('hotkey_delete_current_line')}
            />
            <Hotkey
              combination={`${ctrl} + A`}
              description={t('hotkey_select_all')}
            />
          </OLCol>

          <OLCol xs={4}>
            <Hotkey
              combination="Ctrl + U"
              description={t('hotkey_to_uppercase')}
            />
            <Hotkey
              combination="Ctrl + Shift + U"
              description={t('hotkey_to_lowercase')}
            />
            <Hotkey
              combination="Tab"
              description={t('hotkey_indent_selection')}
            />
          </OLCol>

          <OLCol xs={4}>
            <Hotkey
              combination={`${ctrl} + B`}
              description={t('hotkey_bold_text')}
            />
            <Hotkey
              combination={`${ctrl} + I`}
              description={t('hotkey_italic_text')}
            />
          </OLCol>
        </OLRow>

        <h3>{t('autocomplete')}</h3>

        <OLRow>
          <OLCol xs={4}>
            <Hotkey
              combination="Ctrl + Space"
              description={t('hotkey_autocomplete_menu')}
            />
          </OLCol>
          <OLCol xs={4}>
            <Hotkey
              combination="Up / Down"
              description={t('hotkey_select_candidate')}
            />
          </OLCol>
          <OLCol xs={4}>
            <Hotkey
              combination="Enter / Tab"
              description={t('hotkey_insert_candidate')}
            />
          </OLCol>
        </OLRow>

        <h3>
          <Trans
            i18nKey="autocomplete_references"
            components={{ code: <code /> }}
          />
        </h3>

        <OLRow>
          <OLCol xs={4}>
            <Hotkey
              combination="Ctrl + Space"
              description={t('hotkey_search_references')}
            />
          </OLCol>
        </OLRow>

        {trackChangesVisible && (
          <>
            <h3>{t('review')}</h3>

            <OLRow>
              <OLCol xs={4}>
                <Hotkey
                  combination={`${ctrl} + J`}
                  description={t('hotkey_toggle_review_panel')}
                />
              </OLCol>
              <OLCol xs={4}>
                <Hotkey
                  combination={`${ctrl} + Shift + A`}
                  description={t('hotkey_toggle_track_changes')}
                />
              </OLCol>
              <OLCol xs={4}>
                <Hotkey
                  combination={`${ctrl} + Shift + C`}
                  description={t('hotkey_add_a_comment')}
                />
              </OLCol>
            </OLRow>
          </>
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleHide}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
})
