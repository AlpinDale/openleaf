import { Link } from 'react-router'
import { AccountMenu } from './account-menu'

/** Top bar of the dashboard and account pages. */
export function AppHeader() {
  return (
    <header className="openleaf-app-header">
      <Link to="/" className="openleaf-app-header-brand">
        OpenLeaf
      </Link>
      <AccountMenu />
    </header>
  )
}
