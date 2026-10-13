import classNames from 'classnames'
import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import { useMe } from '@/api/auth'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import { type CompileUiStatus, useCompileStore } from '../compile-store'
import { PdfLogsPane } from './pdf-logs-pane'
import { PdfToolbar } from './pdf-toolbar'
import { PdfViewer } from './pdf-viewer'
import {
  GoToCodeButton,
  SynctexControls,
  SynctexUnavailableNotice,
} from './synctex-controls'

const FAILURE_MESSAGE_KEYS: Partial<Record<CompileUiStatus, string>> = {
  failure: 'compile_failed_see_logs',
  terminated: 'compilation_stopped',
  'no-root-doc': 'no_root_doc_set_one_in_settings',
  'validation-problems': 'syntax_check_found_errors',
}

function CompileMessages() {
  const { t } = useTranslation()
  const status = useCompileStore(s => s.status)
  const error = useCompileStore(s => s.error)
  const result = useCompileStore(s => s.result)
  const setLogsOpen = useCompileStore(s => s.setLogsOpen)

  let message: string | null = null
  if (error) message = error
  else if (status === 'timedout' && result) {
    message = t('compile_timed_out_after', {
      seconds: Math.round(result.durationMs / 1000),
    })
  } else {
    const key = FAILURE_MESSAGE_KEYS[status]
    if (key) message = t(key)
  }
  if (!message) return null
  const showLogsAction =
    status === 'failure' ||
    status === 'validation-problems' ||
    status === 'timedout'
  return (
    <div className="pdf-preview-messages" data-testid="compile-message">
      <Notification
        type={status === 'terminated' ? 'info' : 'error'}
        content={message}
        action={
          showLogsAction ? (
            <OLButton
              variant="secondary"
              size="sm"
              onClick={() => setLogsOpen(true)}
            >
              {t('view_logs')}
            </OLButton>
          ) : undefined
        }
      />
    </div>
  )
}

/** The PDF preview: toolbar, PDF viewer, logs and SyncTeX controls. */
export function PdfPanel() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const pdfUrl = useCompileStore(s => s.pdfUrl)
  const status = useCompileStore(s => s.status)
  const logsOpen = useCompileStore(s => s.logsOpen)
  const detached = useCompileStore(s => s.detached)
  const settings = useMe().data?.settings
  // the browser's own viewer: no pdf.js controls, dark mode or SyncTeX
  const native = settings?.pdfViewer === 'native'
  const pdfDarkMode = !native && (settings?.pdfDarkMode ?? false)

  let detachedSynctex: ReactNode = null
  if (detached) {
    detachedSynctex = native ? (
      <SynctexUnavailableNotice />
    ) : (
      <GoToCodeButton detached />
    )
  }

  return (
    <div
      className="ide-redesign-pdf-container ide-redesign-full-height openleaf-pdf-panel"
      data-testid="pdf-panel"
    >
      <div
        className={classNames('pdf full-size', {
          'pdf-empty': !pdfUrl,
          'pdf-dark-mode': pdfDarkMode,
        })}
      >
        <PdfToolbar native={native} extra={detachedSynctex} />
        <div className="pdf-viewer" data-testid="pdf-viewer">
          {pdfUrl ? (
            native ? (
              <iframe
                title={t('pdf_preview')}
                src={pdfUrl}
                className="openleaf-native-pdf-viewer"
                data-testid="pdf-native-viewer"
              />
            ) : (
              <PdfViewer url={pdfUrl} projectId={id} />
            )
          ) : (
            status === 'compiling' && (
              <div className="openleaf-pdf-placeholder">
                <OLSpinner size="sm" /> {t('compiling')}…
              </div>
            )
          )}
          <CompileMessages />
        </div>
        {logsOpen && <PdfLogsPane />}
      </div>
      {!detached &&
        (native ? (
          <div className="synctex-controls openleaf-synctex-controls">
            <SynctexUnavailableNotice />
          </div>
        ) : (
          <SynctexControls />
        ))}
    </div>
  )
}
