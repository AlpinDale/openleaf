import { useNavigate } from 'react-router'
import { logout, useCurrentMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownHeader,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'

/** Account dropdown: dashboard, account settings, log out. */
export function AccountMenu({ toggleClassName }: { toggleClassName?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useCurrentMe()

  const onLogout = async () => {
    try {
      await logout()
      navigate('/login')
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  return (
    <OLDropdown align="end">
      <OLDropdownToggle
        id="account-menu-toggle"
        variant="ghost"
        size="sm"
        className={toggleClassName}
        aria-label={t('account')}
        data-testid="account-menu"
      >
        <MaterialIcon type="account_circle" />
      </OLDropdownToggle>
      <OLDropdownMenu>
        <OLDropdownHeader>
          <div className="fw-bold">{user.name}</div>
          <div className="small">{user.email}</div>
        </OLDropdownHeader>
        <OLDropdownDivider />
        <OLDropdownItem
          as="button"
          onClick={() => navigate('/')}
          leadingIcon="home"
        >
          {t('projects')}
        </OLDropdownItem>
        <OLDropdownItem
          as="button"
          onClick={() => navigate('/settings')}
          leadingIcon="settings"
        >
          {t('account_settings')}
        </OLDropdownItem>
        <OLDropdownDivider />
        <OLDropdownItem as="button" onClick={onLogout} leadingIcon="logout">
          {t('log_out')}
        </OLDropdownItem>
      </OLDropdownMenu>
    </OLDropdown>
  )
}
