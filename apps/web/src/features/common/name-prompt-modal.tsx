import { type FormEvent, useEffect, useState } from 'react'
import { errorMessage } from '@/api/client'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

/** Single text-field dialog (project names, labels, …). */
export function NamePromptModal({
  show,
  title,
  label,
  initialValue = '',
  submitLabel,
  maxLength = 150,
  validate,
  onSubmit,
  onHide,
  testId,
}: {
  show: boolean
  title: string
  label: string
  initialValue?: string
  submitLabel: string
  maxLength?: number
  /** Returns a problem description, or null when the value is acceptable. */
  validate?: (value: string) => string | null
  onSubmit: (value: string) => Promise<void> | void
  onHide: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (show) {
      setValue(initialValue)
      setError(null)
    }
  }, [show, initialValue])

  const trimmed = value.trim()
  const problem = trimmed ? (validate?.(trimmed) ?? null) : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed || problem) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onHide()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OLModal show={show} onHide={onHide} data-testid={testId}>
      <OLForm onSubmit={submit}>
        <OLModalHeader>
          <OLModalTitle>{title}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <OLFormGroup controlId="name-prompt-input">
            <OLFormLabel>{label}</OLFormLabel>
            <OLFormControl
              autoFocus
              required
              maxLength={maxLength}
              value={value}
              isInvalid={!!problem}
              onChange={e => setValue(e.target.value)}
              onFocus={e => e.target.select()}
            />
            {problem && (
              <div className="invalid-feedback d-block">{problem}</div>
            )}
          </OLFormGroup>
          {error && <Notification type="error" content={error} />}
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={onHide} disabled={busy}>
            {t('cancel')}
          </OLButton>
          <OLButton
            type="submit"
            variant="primary"
            isLoading={busy}
            disabled={!trimmed || !!problem}
          >
            {submitLabel}
          </OLButton>
        </OLModalFooter>
      </OLForm>
    </OLModal>
  )
}
