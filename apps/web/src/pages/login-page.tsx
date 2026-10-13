import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { login } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { AuthCard } from '@/features/auth/auth-card'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'

export default function LoginPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // On success the guest route redirects to `?next=` or the dashboard.
      await login(email, password)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const next = searchParams.get('next')
  return (
    <AuthCard
      title={t('log_in')}
      footer={
        <>
          {t('dont_have_account')}{' '}
          <Link
            to={
              next ? `/register?next=${encodeURIComponent(next)}` : '/register'
            }
          >
            {t('register')}
          </Link>
        </>
      }
    >
      <OLForm onSubmit={onSubmit} data-testid="login-form">
        {error && (
          <div className="login-register-error-container">
            <Notification type="error" content={error} />
          </div>
        )}
        <OLFormGroup controlId="login-email">
          <OLFormLabel>{t('email')}</OLFormLabel>
          <OLFormControl
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </OLFormGroup>
        <OLFormGroup controlId="login-password">
          <OLFormLabel>{t('password')}</OLFormLabel>
          <OLFormControl
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </OLFormGroup>
        <OLButton
          type="submit"
          variant="primary"
          className="w-100"
          isLoading={busy}
        >
          {t('log_in')}
        </OLButton>
      </OLForm>
    </AuthCard>
  )
}
