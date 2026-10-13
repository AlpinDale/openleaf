import { type FormEvent, useState } from 'react'
import { changePassword, patchMe, useCurrentMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'

type Status = { type: 'success' | 'error'; message: string } | null

export function NameSection() {
  const { t } = useTranslation()
  const { user } = useCurrentMe()
  const [name, setName] = useState(user.name)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !name.trim() || name.trim() === user.name) return
    setBusy(true)
    setStatus(null)
    try {
      await patchMe({ name: name.trim() })
      setStatus({ type: 'success', message: t('thanks_settings_updated') })
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <OLForm onSubmit={onSubmit} data-testid="change-name-form">
      <h2 className="h4">{t('update_account_info')}</h2>
      <OLFormGroup controlId="account-email">
        <OLFormLabel>{t('email')}</OLFormLabel>
        <OLFormControl value={user.email} readOnly plaintext />
      </OLFormGroup>
      <OLFormGroup controlId="account-name">
        <OLFormLabel>{t('name')}</OLFormLabel>
        <OLFormControl
          required
          maxLength={100}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </OLFormGroup>
      {status && (
        <Notification
          type={status.type}
          content={status.message}
          className="mb-3"
        />
      )}
      <OLButton
        type="submit"
        variant="primary"
        isLoading={busy}
        disabled={!name.trim() || name.trim() === user.name}
      >
        {t('update')}
      </OLButton>
    </OLForm>
  )
}

export function PasswordSection() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const mismatch = confirm.length > 0 && next !== confirm

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || next !== confirm) return
    setBusy(true)
    setStatus(null)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setStatus({ type: 'success', message: t('password_change_successful') })
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <OLForm onSubmit={onSubmit} data-testid="change-password-form">
      <h2 className="h4">{t('change_password')}</h2>
      <OLFormGroup controlId="current-password">
        <OLFormLabel>{t('current_password')}</OLFormLabel>
        <OLFormControl
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={e => setCurrent(e.target.value)}
        />
      </OLFormGroup>
      <OLFormGroup controlId="new-password">
        <OLFormLabel>{t('new_password')}</OLFormLabel>
        <OLFormControl
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={e => setNext(e.target.value)}
        />
      </OLFormGroup>
      <OLFormGroup controlId="confirm-password">
        <OLFormLabel>{t('confirm_new_password')}</OLFormLabel>
        <OLFormControl
          type="password"
          autoComplete="new-password"
          required
          isInvalid={mismatch}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
        />
        {mismatch && (
          <div className="invalid-feedback d-block">{t('doesnt_match')}</div>
        )}
      </OLFormGroup>
      {status && (
        <Notification
          type={status.type}
          content={status.message}
          className="mb-3"
        />
      )}
      <OLButton
        type="submit"
        variant="primary"
        isLoading={busy}
        disabled={mismatch}
      >
        {t('change')}
      </OLButton>
    </OLForm>
  )
}
