// Adapted from Overleaf services/web/frontend/js/features/pdf-preview/hooks/use-detached-orphan-detection.ts
// and components/pdf-preview-hybrid-toolbar-orphan-refresh-inner.tsx (AGPL-3.0).
import { useEffect, useState } from 'react'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import { useCompileStore } from '../compile-store'

/** Grace period for the editor window to answer before showing the banner. */
const ORPHAN_UI_TIMEOUT_MS = 5000

/**
 * Detached PDF window: once no editor window has been connected for a while
 * (closed, navigated away, never opened), offers to open the editor. The
 * banner disappears as soon as an editor window for the project connects.
 */
export function DetachedOrphanBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const linked = useCompileStore(s => s.editorLinked)
  const [orphan, setOrphan] = useState(false)

  useEffect(() => {
    if (linked) {
      setOrphan(false)
      return
    }
    const timer = window.setTimeout(() => setOrphan(true), ORPHAN_UI_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [linked])

  if (!orphan) return null
  return (
    <div
      className="openleaf-detached-orphan-banner"
      data-testid="detached-orphan-banner"
    >
      <Notification
        type="warning"
        content={t('detached_pdf_orphan')}
        action={
          <OLButton
            variant="secondary"
            size="sm"
            onClick={() => window.location.assign(`/project/${projectId}`)}
          >
            {t('redirect_to_editor')}
          </OLButton>
        }
      />
    </div>
  )
}
