import classNames from 'classnames'
import { useEffect, useState } from 'react'
import { patchMe, useMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLButtonGroup from '@/shared/components/ol/ol-button-group'
import OLButtonToolbar from '@/shared/components/ol/ol-button-toolbar'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownHeader,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
  OLDropdownToggleCustom,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { isMac } from '@/shared/utils/os'
import { useCompileStore } from '../compile-store'
import {
  requestPresentationMode,
  setPage,
  setZoom,
  stepPage,
  usePdfViewerStore,
} from '../pdf-viewer-store'

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2, 4]

export function PdfCompileButton() {
  const { t } = useTranslation()
  const compiling = useCompileStore(s => s.status === 'compiling')
  const autoCompile = useCompileStore(s => s.autoCompile)
  const draft = useCompileStore(s => s.draft)
  const syntaxCheck = useCompileStore(s => s.syntaxCheck)
  const stopOnFirstError = useCompileStore(s => s.stopOnFirstError)
  const detached = useCompileStore(s => s.detached)
  const { compile, stop, clearCache, setOption, recompileFromScratch } =
    useCompileStore.getState()

  const option = (
    label: string,
    checked: boolean,
    onClick: () => void,
    testId?: string
  ) => (
    <li role="none">
      <OLDropdownItem
        as="button"
        onClick={onClick}
        trailingIcon={checked ? 'check' : null}
        data-testid={testId}
      >
        {label}
      </OLDropdownItem>
    </li>
  )

  return (
    <OLDropdown as={OLButtonGroup} className="compile-button-group">
      <OLTooltip
        description={
          <>
            {t('recompile_pdf')}{' '}
            <span className="keyboard-shortcut">
              ({isMac ? 'Cmd' : 'Ctrl'} + Enter)
            </span>
          </>
        }
        id="compile"
        tooltipProps={{ className: 'keyboard-tooltip' }}
        overlayProps={{ delay: { show: 500, hide: 0 } }}
      >
        <OLButton
          variant="primary"
          disabled={compiling}
          isLoading={compiling}
          onClick={() => void compile()}
          className="align-items-center py-0 no-left-radius px-3 compile-button"
          loadingLabel={`${t('compiling')}…`}
          data-testid="recompile-button"
        >
          {t('recompile')}
        </OLButton>
      </OLTooltip>
      <OLDropdownToggle
        as={OLDropdownToggleCustom}
        split
        variant="primary"
        id="pdf-recompile-dropdown"
        size="sm"
        aria-label={t('toggle_compile_options_menu')}
        className="no-left-border dropdown-button-toggle compile-dropdown-toggle"
        data-testid="recompile-dropdown"
      />
      <OLDropdownMenu>
        <OLDropdownHeader>{t('auto_compile')}</OLDropdownHeader>
        {option(t('on'), autoCompile, () => setOption('autoCompile', true))}
        {option(t('off'), !autoCompile, () => setOption('autoCompile', false))}
        <OLDropdownDivider />
        <OLDropdownHeader>{t('compile_mode')}</OLDropdownHeader>
        {option(t('normal'), !draft, () => setOption('draft', false))}
        {option(`${t('fast')} [draft]`, draft, () => setOption('draft', true))}
        <OLDropdownDivider />
        <OLDropdownHeader>{t('syntax_checks')}</OLDropdownHeader>
        {option(t('stop_on_validation_error'), syntaxCheck, () =>
          setOption('syntaxCheck', true)
        )}
        {option(t('ignore_validation_errors'), !syntaxCheck, () =>
          setOption('syntaxCheck', false)
        )}
        <OLDropdownDivider />
        <OLDropdownHeader>{t('compile_error_handling')}</OLDropdownHeader>
        {option(t('stop_on_first_error'), stopOnFirstError, () =>
          setOption('stopOnFirstError', true)
        )}
        {option(t('try_to_compile_despite_errors'), !stopOnFirstError, () =>
          setOption('stopOnFirstError', false)
        )}
        {!detached && (
          <>
            <OLDropdownDivider />
            <li role="none">
              <OLDropdownItem
                as="button"
                onClick={() => void stop()}
                disabled={!compiling}
                aria-disabled={!compiling}
                data-testid="stop-compile"
              >
                {t('stop_compile')}
              </OLDropdownItem>
            </li>
            <li role="none">
              <OLDropdownItem
                as="button"
                onClick={() => void clearCache()}
                disabled={compiling}
                aria-disabled={compiling}
                data-testid="clear-cache"
              >
                {t('clear_cached_files')}
              </OLDropdownItem>
            </li>
            <li role="none">
              <OLDropdownItem
                as="button"
                onClick={() => void recompileFromScratch()}
                disabled={compiling}
                aria-disabled={compiling}
                data-testid="recompile-from-scratch"
              >
                {t('recompile_from_scratch')}
              </OLDropdownItem>
            </li>
          </>
        )}
      </OLDropdownMenu>
    </OLDropdown>
  )
}

function LogsButton() {
  const { t } = useTranslation()
  const logsOpen = useCompileStore(s => s.logsOpen)
  const errorCount = useCompileStore(s => s.logEntries.errors.length)
  const warningCount = useCompileStore(s => s.logEntries.warnings.length)
  const setLogsOpen = useCompileStore(s => s.setLogsOpen)
  const total = errorCount + warningCount

  if (logsOpen) {
    return (
      <OLButton
        variant="secondary"
        size="sm"
        onClick={() => setLogsOpen(false)}
        data-testid="logs-button"
      >
        {t('back_to_pdf')}
      </OLButton>
    )
  }
  return (
    <OLTooltip
      id="logs-toggle"
      description={t('logs_and_output_files')}
      overlayProps={{ placement: 'bottom' }}
    >
      <OLButton
        variant="link"
        className="pdf-toolbar-btn toolbar-item log-btn"
        onClick={() => setLogsOpen(true)}
        style={{ position: 'relative' }}
        aria-label={t('view_logs')}
        data-testid="logs-button"
      >
        <MaterialIcon type="description" />
        {total > 0 && (
          <OLBadge
            bg={errorCount === 0 ? 'warning' : 'danger'}
            data-testid="logs-count"
            data-errors={errorCount}
            data-warnings={warningCount}
          >
            {total}
          </OLBadge>
        )}
      </OLButton>
    </OLTooltip>
  )
}

function DownloadButton() {
  const { t } = useTranslation()
  const pdfUrl = useCompileStore(s => s.pdfUrl)
  if (!pdfUrl) return null
  return (
    <OLTooltip
      id="download-pdf"
      description={t('download_pdf')}
      overlayProps={{ placement: 'bottom' }}
    >
      <a
        href={pdfUrl}
        download="output.pdf"
        className="btn btn-link pdf-toolbar-btn toolbar-item"
        aria-label={t('download_pdf')}
        data-testid="download-pdf"
      >
        <MaterialIcon type="download" />
      </a>
    </OLTooltip>
  )
}

/** Duration of the running or last compile (failure kinds show over the PDF). */
function CompileStatusText() {
  const { t } = useTranslation()
  const status = useCompileStore(s => s.status)
  const result = useCompileStore(s => s.result)
  const startedAt = useCompileStore(s => s.compileStartedAt)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (status !== 'compiling') return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [status])

  let ms: number | null = null
  if (status === 'compiling' && startedAt) ms = now - startedAt
  else if (result) ms = result.durationMs
  if (ms === null) return null
  const seconds = (ms / 1000).toFixed(1)
  return (
    <OLTooltip
      id="pdf-compile-time"
      description={t('last_compile_duration', { seconds })}
      overlayProps={{ placement: 'bottom' }}
    >
      <span
        className="toolbar-pdf-compile-time"
        data-testid="compile-status-text"
        data-status={status}
      >
        <MaterialIcon
          type={status === 'compiling' ? 'hourglass_top' : 'timer'}
        />
        <span>{seconds} s</span>
      </span>
    </OLTooltip>
  )
}

function ZoomControls() {
  const { t } = useTranslation()
  const rawScale = usePdfViewerStore(s => s.rawScale)
  const ready = usePdfViewerStore(
    s => s.wrapper !== null && s.totalPages !== null
  )
  const percent = rawScale ? `${Math.round(rawScale * 100)}%` : '—'

  return (
    <div className="pdfjs-zoom-controls" data-testid="pdf-zoom-controls">
      <div className="pdfjs-toolbar-buttons">
        <OLButton
          variant="ghost"
          size="sm"
          className="pdfjs-toolbar-button"
          onClick={() => setZoom('zoom-out')}
          disabled={!ready}
          aria-label={t('zoom_out')}
          data-testid="zoom-out"
        >
          <MaterialIcon type="remove" />
        </OLButton>
        <OLDropdown align="end">
          <OLDropdownToggle
            id="pdf-zoom-dropdown"
            variant="ghost"
            size="sm"
            className="pdfjs-zoom-dropdown-button"
            disabled={!ready}
            data-testid="zoom-dropdown"
          >
            {percent}
          </OLDropdownToggle>
          <OLDropdownMenu>
            <li role="none">
              <OLDropdownItem as="button" onClick={() => setZoom('page-width')}>
                {t('fit_to_width')}
              </OLDropdownItem>
            </li>
            <li role="none">
              <OLDropdownItem
                as="button"
                onClick={() => setZoom('page-height')}
              >
                {t('fit_to_height')}
              </OLDropdownItem>
            </li>
            <OLDropdownDivider />
            <li role="none">
              <OLDropdownItem
                as="button"
                onClick={requestPresentationMode}
                data-testid="zoom-presentation-mode"
              >
                {t('presentation_mode')}
              </OLDropdownItem>
            </li>
            <OLDropdownDivider />
            {ZOOM_PRESETS.map(scale => (
              <li role="none" key={scale}>
                <OLDropdownItem
                  as="button"
                  onClick={() => setZoom(String(scale))}
                  data-testid={`zoom-${scale * 100}`}
                >
                  {`${scale * 100}%`}
                </OLDropdownItem>
              </li>
            ))}
          </OLDropdownMenu>
        </OLDropdown>
        <OLButton
          variant="ghost"
          size="sm"
          className="pdfjs-toolbar-button"
          onClick={() => setZoom('zoom-in')}
          disabled={!ready}
          aria-label={t('zoom_in')}
          data-testid="zoom-in"
        >
          <MaterialIcon type="add" />
        </OLButton>
      </div>
    </div>
  )
}

function PageNumberControl() {
  const { t } = useTranslation()
  const page = usePdfViewerStore(s => s.page)
  const totalPages = usePdfViewerStore(s => s.totalPages)
  const [value, setValue] = useState(String(page ?? ''))

  useEffect(() => setValue(String(page ?? '')), [page])

  if (!totalPages) return null
  return (
    <>
      <div className="pdfjs-toolbar-buttons">
        <OLTooltip
          id="pdf-previous-page"
          description={t('previous_page')}
          overlayProps={{ placement: 'bottom' }}
        >
          <OLButton
            variant="ghost"
            size="sm"
            className="pdfjs-toolbar-button"
            onClick={() => stepPage(-1)}
            disabled={page === null || page <= 1}
            aria-label={t('previous_page')}
            data-testid="pdf-previous-page"
          >
            <MaterialIcon type="keyboard_arrow_up" />
          </OLButton>
        </OLTooltip>
        <OLTooltip
          id="pdf-next-page"
          description={t('next_page')}
          overlayProps={{ placement: 'bottom' }}
        >
          <OLButton
            variant="ghost"
            size="sm"
            className="pdfjs-toolbar-button"
            onClick={() => stepPage(1)}
            disabled={page === null || page >= totalPages}
            aria-label={t('next_page')}
            data-testid="pdf-next-page"
          >
            <MaterialIcon type="keyboard_arrow_down" />
          </OLButton>
        </OLTooltip>
      </div>
      <div className="pdfjs-page-number-input">
        <form
          onSubmit={event => {
            event.preventDefault()
            const next = Number.parseInt(value, 10)
            if (next >= 1 && next <= totalPages) setPage(next)
            else setValue(String(page ?? ''))
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            value={value}
            onChange={event => setValue(event.target.value)}
            onBlur={() => setValue(String(page ?? ''))}
            aria-label={t('page_number')}
            data-testid="pdf-page-input"
          />
        </form>
        <span data-testid="pdf-total-pages">/ {totalPages}</span>
      </div>
    </>
  )
}

function DarkModeButton() {
  const { t } = useTranslation()
  const pdfDarkMode = useMe().data?.settings.pdfDarkMode ?? false
  return (
    <OLTooltip
      id="pdf-dark-mode"
      description={t('dark_mode_pdf_preview')}
      overlayProps={{ placement: 'bottom' }}
    >
      <OLButton
        variant="link"
        className={classNames('pdf-toolbar-btn toolbar-item theme-toggle-btn', {
          active: pdfDarkMode,
        })}
        onClick={() =>
          patchMe({ settings: { pdfDarkMode: !pdfDarkMode } }).catch(err =>
            showToast({ type: 'error', content: errorMessage(err) })
          )
        }
        aria-pressed={pdfDarkMode}
        aria-label={t('dark_mode_pdf_preview')}
        data-testid="pdf-dark-mode"
      >
        <MaterialIcon type="dark_mode" />
      </OLButton>
    </OLTooltip>
  )
}

function PresentationModeButton() {
  const { t } = useTranslation()
  const ready = usePdfViewerStore(s => s.wrapper !== null)
  return (
    <OLTooltip
      id="pdf-presentation-mode"
      description={t('presentation_mode')}
      overlayProps={{ placement: 'bottom' }}
    >
      <OLButton
        variant="link"
        className="pdf-toolbar-btn toolbar-item"
        onClick={requestPresentationMode}
        disabled={!ready}
        aria-label={t('presentation_mode')}
        data-testid="pdf-presentation-mode"
      >
        <MaterialIcon type="slideshow" />
      </OLButton>
    </OLTooltip>
  )
}

/**
 * `native`: the browser's PDF viewer is in use, so the pdf.js page, zoom and
 * dark-mode controls don't apply.
 */
export function PdfToolbar({
  extra,
  native = false,
}: {
  extra?: React.ReactNode
  native?: boolean
}) {
  const { t } = useTranslation()
  const hasPdf = useCompileStore(s => s.pdfUrl !== null)
  return (
    <OLButtonToolbar
      className="toolbar toolbar-pdf toolbar-pdf-hybrid"
      aria-label={t('pdf')}
    >
      <div className="toolbar-pdf-left">
        <PdfCompileButton />
        <LogsButton />
        <DownloadButton />
        <CompileStatusText />
      </div>
      <div className="toolbar-pdf-right">
        <div className="toolbar-pdf-controls">
          {hasPdf && !native && (
            <div className="pdfjs-viewer-controls">
              <PageNumberControl />
              <ZoomControls />
              <PresentationModeButton />
            </div>
          )}
        </div>
        {!native && <DarkModeButton />}
        {extra}
      </div>
    </OLButtonToolbar>
  )
}
