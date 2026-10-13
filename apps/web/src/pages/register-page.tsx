import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { register } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { AuthCard } from '@/features/auth/auth-card'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'

const MIN_PASSWORD_LENGTH = 8

export default function RegisterPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
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
      await register(name, email, password)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const next = searchParams.get('next')
  return (
    <AuthCard
      title={t('register')}
      footer={
        <>
          {t('already_have_an_account')}{' '}
          <Link
            to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          >
            {t('log_in_here')}
          </Link>
        </>
      }
    >
      <OLForm onSubmit={onSubmit} data-testid="register-form">
        {error && (
          <div className="login-register-error-container">
            <Notification type="error" content={error} />
          </div>
        )}
        <OLFormGroup controlId="register-name">
          <OLFormLabel>{t('name')}</OLFormLabel>
          <OLFormControl
            name="name"
            autoComplete="name"
            required
            autoFocus
            maxLength={100}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </OLFormGroup>
        <OLFormGroup controlId="register-email">
          <OLFormLabel>{t('email')}</OLFormLabel>
          <OLFormControl
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </OLFormGroup>
        <OLFormGroup controlId="register-password">
          <OLFormLabel>{t('password')}</OLFormLabel>
          <OLFormControl
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <OLFormText>
            {t('password_min_length', { count: MIN_PASSWORD_LENGTH })}
          </OLFormText>
        </OLFormGroup>
        <OLButton
          type="submit"
          variant="primary"
          className="w-100"
          isLoading={busy}
        >
          {t('register')}
        </OLButton>
      </OLForm>
    </AuthCard>
  )
}
