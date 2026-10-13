import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useLocation,
  useSearchParams,
} from 'react-router'
import { useMe } from '@/api/auth'
import { isApiError } from '@/api/client'
import { useApplyTheme } from '@/features/theme/use-apply-theme'
import { useTranslation } from '@/i18n'
import AccountPage from '@/pages/account-page'
import DashboardPage from '@/pages/dashboard-page'
import DetachedPdfPage from '@/pages/detached-pdf-page'
import EditorPage from '@/pages/editor-page'
import LoginPage from '@/pages/login-page'
import RegisterPage from '@/pages/register-page'
import { FullSizeLoadingSpinner } from '@/shared/components/loading-spinner'
import Notification from '@/shared/components/notification'

/** Routes for signed-in users; redirects to `/login` on 401. */
function RequireUser() {
  const { t } = useTranslation()
  const location = useLocation()
  const me = useMe()
  useApplyTheme(me.data?.settings.overallTheme ?? 'system')

  if (me.isPending) return <FullSizeLoadingSpinner delay={500} />
  if (me.isError) {
    if (isApiError(me.error, 'unauthorized')) {
      const next = `${location.pathname}${location.search}`
      return (
        <Navigate
          to={
            next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
          }
          replace
        />
      )
    }
    return (
      <div className="container py-5">
        <Notification
          type="error"
          title={t('generic_something_went_wrong')}
          content={me.error.message}
        />
      </div>
    )
  }
  return <Outlet />
}

/** Login and registration; signed-in users continue to `?next=` or the dashboard. */
function GuestOnly() {
  const me = useMe()
  const [searchParams] = useSearchParams()
  useApplyTheme(me.data?.settings.overallTheme ?? 'system')
  if (me.isPending) return <FullSizeLoadingSpinner delay={500} />
  if (me.data) {
    const next = searchParams.get('next')
    // Only same-origin paths: `//host` would leave the app.
    const safe = next?.startsWith('/') && !next.startsWith('//') ? next : '/'
    return <Navigate to={safe} replace />
  }
  return <Outlet />
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireUser />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/settings', element: <AccountPage /> },
      { path: '/project/:id', element: <EditorPage /> },
      { path: '/project/:id/pdf', element: <DetachedPdfPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
