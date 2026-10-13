import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { syncCursorToPdf, syncToCode, useCompileStore } from '../compile-store'
import { viewportCenterPosition } from '../pdf-viewer-store'

/** PDF → code for the centre of the PDF viewport. */
export function syncViewportToCode() {
  const position = viewportCenterPosition()
  if (position) void syncToCode(position)
}

export function GoToPdfButton({ detached = false }: { detached?: boolean }) {
  const { t } = useTranslation()
  const inFlight = useCompileStore(s => s.syncInFlight)
  const hasPdf = useCompileStore(s => s.pdfUrl !== null)
  return (
    <OLTooltip
      id="sync-to-pdf"
      description={t('go_to_code_location_in_pdf')}
      overlayProps={{ placement: detached ? 'bottom' : 'right' }}
    >
      <span>
        <OLButton
          variant="secondary"
          size="sm"
          onClick={() => syncCursorToPdf()}
          disabled={inFlight || !hasPdf}
          className={
            detached
              ? 'synctex-control detach-synctex-control'
              : 'synctex-control'
          }
          aria-label={t('go_to_code_location_in_pdf')}
          data-testid="sync-to-pdf"
        >
          {inFlight ? (
            <OLSpinner size="sm" />
          ) : (
            !detached && (
              <MaterialIcon
                type="arrow_right_alt"
                className="synctex-control-icon"
              />
            )
          )}
          {detached && <span>&nbsp;{t('show_in_pdf')}</span>}
        </OLButton>
      </span>
    </OLTooltip>
  )
}

export function GoToCodeButton({ detached = false }: { detached?: boolean }) {
  const { t } = useTranslation()
  const inFlight = useCompileStore(s => s.syncInFlight)
  const hasPdf = useCompileStore(s => s.pdfUrl !== null)
  return (
    <OLTooltip
      id="sync-to-code"
      description={t('go_to_pdf_location_in_code')}
      overlayProps={{ placement: detached ? 'bottom' : 'right' }}
    >
      <span>
        <OLButton
          variant="secondary"
          size="sm"
          onClick={syncViewportToCode}
          disabled={inFlight || !hasPdf}
          className={
            detached
              ? 'synctex-control detach-synctex-control'
              : 'synctex-control'
          }
          aria-label={t('go_to_pdf_location_in_code')}
          data-testid="sync-to-code"
        >
          {inFlight ? (
            <OLSpinner size="sm" />
          ) : (
            !detached && (
              <MaterialIcon
                type="arrow_left_alt"
                className="synctex-control-icon"
              />
            )
          )}
          {detached && <span>&nbsp;{t('show_in_code')}</span>}
        </OLButton>
      </span>
    </OLTooltip>
  )
}

/** The →/← buttons at the PDF panel's left edge. */
export function SynctexControls() {
  return (
    <div className="synctex-controls openleaf-synctex-controls">
      <GoToPdfButton />
      <GoToCodeButton />
    </div>
  )
}

/** Stands in for the SyncTeX buttons while the browser's PDF viewer is used. */
export function SynctexUnavailableNotice() {
  const { t } = useTranslation()
  return (
    <OLTooltip
      id="synctex-unavailable"
      description={t('synctex_unavailable_native_viewer')}
      overlayProps={{ placement: 'bottom' }}
    >
      <span
        className="openleaf-synctex-unavailable"
        role="img"
        aria-label={t('synctex_unavailable_native_viewer')}
        data-testid="synctex-unavailable"
      >
        <MaterialIcon type="info" />
      </span>
    </OLTooltip>
  )
}
