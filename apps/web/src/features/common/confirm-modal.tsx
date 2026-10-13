import { type ReactNode, useState } from 'react'
import { errorMessage } from '@/api/client'
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

/** Yes/no dialog; `onConfirm` errors stay in the dialog. */
export function ConfirmModal({
  show,
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onHide,
  testId,
  confirmTestId,
}: {
  show: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
  onHide: () => void
  testId?: string
  confirmTestId?: string
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onHide()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OLModal
      show={show}
      onHide={onHide}
      onExited={() => setError(null)}
      data-testid={testId}
    >
      <OLModalHeader>
        <OLModalTitle>{title}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {children}
        {error && (
          <Notification type="error" content={error} className="mt-3" />
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide} disabled={busy}>
          {t('cancel')}
        </OLButton>
        <OLButton
          variant={danger ? 'danger' : 'primary'}
          onClick={confirm}
          data-testid={confirmTestId}
          isLoading={busy}
        >
          {confirmLabel}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
