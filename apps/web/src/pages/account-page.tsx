import { GitTokensSection } from '@/features/account/git-tokens-section'
import { LearnedWordsSection } from '@/features/account/learned-words-section'
import {
  NameSection,
  PasswordSection,
} from '@/features/account/profile-section'
import { AppHeader } from '@/features/common/app-header'
import { useTranslation } from '@/i18n'

export default function AccountPage() {
  const { t } = useTranslation()
  return (
    <div className="openleaf-page">
      <AppHeader />
      <main className="container openleaf-account">
        <h1 className="h3">{t('account_settings')}</h1>
        <div className="row g-4">
          <div className="col-lg-6">
            <div className="card">
              <div className="card-body">
                <NameSection />
              </div>
            </div>
          </div>
          <div className="col-lg-6">
            <div className="card">
              <div className="card-body">
                <PasswordSection />
              </div>
            </div>
          </div>
          <div className="col-12">
            <div className="card">
              <div className="card-body">
                <GitTokensSection />
              </div>
            </div>
          </div>
          <div className="col-12">
            <div className="card">
              <div className="card-body">
                <LearnedWordsSection />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
