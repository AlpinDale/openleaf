// Modal adapted from Overleaf services/web/frontend/js/features/ide-react/components/modals/out-of-sync-modal.tsx (AGPL-3.0).
import { FORCED_CLOSE_REASONS } from '@openleaf/shared'
import { useEffect, useRef, useState } from 'react'
import { getEditorView } from '@/features/editor/editor-bridge'
import { useProjectSession } from '@/features/project/session-context'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

/** Unsaved changes older than this show the "connection is slow" warning. */
const STALL_AFTER_MS = 5000

type Fatal =
  | 'no-access'
  | 'project-deleted'
  | 'update-too-large'
  | 'state-too-large'
  | 'invalid-update'

const FATAL_BY_REASON: Record<string, Fatal> = {
  [FORCED_CLOSE_REASONS.projectDeleted]: 'project-deleted',
  [FORCED_CLOSE_REASONS.updateTooLarge]: 'update-too-large',
  [FORCED_CLOSE_REASONS.stateTooLarge]: 'state-too-large',
  [FORCED_CLOSE_REASONS.invalidUpdate]: 'invalid-update',
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/**
 * True once local changes have waited `STALL_AFTER_MS` for the server's
 * acknowledgement; false again as soon as everything is saved.
 */
function useSavingStalled() {
  const { provider } = useProjectSession()
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    let timer: number | undefined
    const update = () => {
      if (!provider.hasUnsyncedChanges) {
        window.clearTimeout(timer)
        timer = undefined
        setStalled(false)
      } else if (timer === undefined) {
        timer = window.setTimeout(() => setStalled(true), STALL_AFTER_MS)
      }
    }
    update()
    provider.on('unsyncedChanges', update)
    return () => {
      window.clearTimeout(timer)
      provider.off('unsyncedChanges', update)
    }
  }, [provider])
  return stalled
}

/**
 * The server refused access or permanently rejected the document update.
 * Rate limits retain local edits and let the provider reconnect.
 */
function useConnectionFailure() {
  const { provider } = useProjectSession()
  const [fatal, setFatal] = useState<Fatal | null>(null)
  const [rateLimited, setRateLimited] = useState(0)
  useEffect(() => {
    setFatal(null)
    setRateLimited(0)
    const onAuthFailed = () => setFatal('no-access')
    const onClose = ({ event }: { event: { reason: string } }) => {
      if (event.reason === FORCED_CLOSE_REASONS.rateLimited) {
        setRateLimited(attempt => attempt + 1)
        return
      }
      const kind = FATAL_BY_REASON[event.reason]
      if (kind) setFatal(kind)
    }
    const onSaved = () => {
      if (!provider.hasUnsyncedChanges) setRateLimited(0)
    }
    provider.on('authenticationFailed', onAuthFailed)
    provider.on('close', onClose)
    provider.on('unsyncedChanges', onSaved)
    provider.on('synced', onSaved)
    return () => {
      provider.off('authenticationFailed', onAuthFailed)
      provider.off('close', onClose)
      provider.off('unsyncedChanges', onSaved)
      provider.off('synced', onSaved)
    }
  }, [provider])
  useEffect(() => {
    // Stop sending edits the server will never accept.
    if (fatal) provider.detach()
  }, [fatal, provider])
  useEffect(() => {
    if (!rateLimited || fatal) return
    // Document CloseMessage leaves the shared socket open. Reattaching starts
    // authentication and a state-vector sync without discarding local edits.
    provider.detach()
    const timer = window.setTimeout(() => provider.attach(), 60_000)
    return () => window.clearTimeout(timer)
  }, [fatal, provider, rateLimited])
  return { fatal, rateLimited: rateLimited > 0 }
}

function FatalConnectionModal({
  fatal,
  onLeave,
}: {
  fatal: Fatal
  /** Reloads the page, or navigates to `url` when given. */
  onLeave: (url?: string) => void
}) {
  const { t } = useTranslation()
  const [localContent, setLocalContent] = useState<string | null>(null)
  const message: Record<Fatal, string> = {
    'no-access': t('connection_no_access_detail'),
    'project-deleted': t('connection_project_deleted_detail'),
    'update-too-large': t('connection_update_too_large_detail'),
    'state-too-large': t('connection_state_too_large_detail'),
    'invalid-update': t('connection_invalid_update_detail'),
  }
  const canShowContent = fatal !== 'project-deleted' && getEditorView() !== null

  return (
    <OLModal
      show
      onHide={() => onLeave()}
      backdrop="static"
      keyboard={false}
      className="out-of-sync-modal"
      themed
      data-testid="connection-fatal-modal"
    >
      <OLModalHeader closeButton={false}>
        <OLModalTitle>
          {fatal === 'no-access' || fatal === 'project-deleted'
            ? t('disconnected')
            : t('out_of_sync')}
        </OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <p>{message[fatal]}</p>
        {canShowContent && (
          <OLButton
            variant="secondary"
            onClick={() =>
              setLocalContent(content =>
                content === null
                  ? (getEditorView()?.state.doc.toString() ?? '')
                  : null
              )
            }
          >
            {localContent === null
              ? t('show_local_file_contents')
              : t('hide_local_file_contents')}
          </OLButton>
        )}
        {localContent !== null && (
          <div className="text-preview">
            <textarea
              className="scroll-container form-control mt-2"
              readOnly
              rows={Math.min(20, (localContent.match(/\n/g)?.length ?? 0) + 1)}
              value={localContent}
            />
          </div>
        )}
      </OLModalBody>
      <OLModalFooter>
        {fatal === 'project-deleted' ? (
          <OLButton variant="primary" onClick={() => onLeave('/')}>
            {t('back_to_your_projects')}
          </OLButton>
        ) : (
          <OLButton variant="primary" onClick={() => onLeave()}>
            {t('reload_editor')}
          </OLButton>
        )}
      </OLModalFooter>
    </OLModal>
  )
}

/**
 * Editor-page connection feedback: offline and slow-saving banners, a
 * beforeunload prompt while edits haven't reached the server, and a blocking
 * modal when the server ends the session for good.
 */
export function ConnectionAlerts() {
  const { t } = useTranslation()
  const { provider } = useProjectSession()
  const online = useOnline()
  const stalled = useSavingStalled()
  const { fatal, rateLimited } = useConnectionFailure()
  const leaving = useRef(false)

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current || !provider.hasUnsyncedChanges) return
      event.preventDefault()
      // Chrome < 119 needs returnValue set.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [provider])

  const leave = (url?: string) => {
    leaving.current = true
    if (url) window.location.assign(url)
    else window.location.reload()
  }

  return (
    <>
      {!fatal && (!online || stalled || rateLimited) && (
        <div className="openleaf-connection-alerts" role="status">
          {!online ? (
            <Notification
              type="warning"
              content={t('connection_offline')}
              id="connection-offline"
            />
          ) : (
            <Notification
              type="warning"
              content={t(
                rateLimited ? 'connection_rate_limited' : 'connection_slow'
              )}
              id="connection-slow"
            />
          )}
        </div>
      )}
      {fatal && <FatalConnectionModal fatal={fatal} onLeave={leave} />}
    </>
  )
}
