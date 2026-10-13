import type { ReactNode } from 'react'

export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="openleaf-auth-page">
      <div className="login-register-container">
        <div className="openleaf-auth-brand">OpenLeaf</div>
        <div className="card login-register-card openleaf-auth-card">
          <div className="card-body">
            <div className="login-register-header">
              <h1 className="login-register-header-heading">{title}</h1>
            </div>
            <div className="text-start pt-4">{children}</div>
          </div>
        </div>
        {footer && <p className="login-register-text pt-4">{footer}</p>}
      </div>
    </main>
  )
}
