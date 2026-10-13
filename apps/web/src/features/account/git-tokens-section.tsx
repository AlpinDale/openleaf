import { useState } from 'react'
import { createGitToken, deleteGitToken, useGitTokens } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { NamePromptModal } from '@/features/common/name-prompt-modal'
import { showToast } from '@/features/toasts'
import { formatTimeBasedOnYear } from '@/features/utils/format-date'
import { useTranslation } from '@/i18n'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import LoadingSpinner from '@/shared/components/loading-spinner'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

export function GitTokensSection() {
  const { t } = useTranslation()
  const tokens = useGitTokens()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{
    label: string
    token: string
  } | null>(null)

  const onDelete = async (id: string) => {
    try {
      await deleteGitToken(id)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  return (
    <section data-testid="git-tokens-section">
      <h2 className="h4">{t('git_integration')}</h2>
      <p className="text-muted">{t('git_tokens_explanation')}</p>

      {created && (
        <Notification
          type="success"
          title={t('git_token_created', { label: created.label })}
          isDismissible
          onDismiss={() => setCreated(null)}
          content={
            <>
              <p className="mb-2">{t('git_token_shown_once')}</p>
              <div className="openleaf-secret">
                <code data-testid="git-token-value">{created.token}</code>
                <CopyToClipboard
                  content={created.token}
                  tooltipId="copy-git-token"
                />
              </div>
            </>
          }
          className="mb-3"
        />
      )}

      {tokens.isPending ? (
        <LoadingSpinner />
      ) : tokens.isError ? (
        <Notification type="error" content={tokens.error.message} />
      ) : tokens.data.length === 0 ? (
        <p>{t('no_git_tokens')}</p>
      ) : (
        <table className="table" data-testid="git-token-table">
          <thead>
            <tr>
              <th>{t('label')}</th>
              <th>{t('created_at')}</th>
              <th>{t('last_used')}</th>
              <th>
                <span className="visually-hidden">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.data.map(token => (
              <tr key={token.id}>
                <td>{token.label}</td>
                <td>{formatTimeBasedOnYear(token.createdAt)}</td>
                <td>
                  {token.lastUsedAt
                    ? formatTimeBasedOnYear(token.lastUsedAt)
                    : t('never')}
                </td>
                <td className="text-end">
                  <OLIconButton
                    variant="danger-ghost"
                    size="sm"
                    icon="delete"
                    accessibilityLabel={t('delete_token', {
                      label: token.label,
                    })}
                    onClick={() => onDelete(token.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <OLButton
        variant="secondary"
        onClick={() => setCreating(true)}
        data-testid="create-git-token"
      >
        {t('generate_token')}
      </OLButton>

      <NamePromptModal
        show={creating}
        title={t('generate_token')}
        label={t('label')}
        submitLabel={t('generate_token')}
        maxLength={100}
        testId="create-git-token-modal"
        onHide={() => setCreating(false)}
        onSubmit={async label => {
          const result = await createGitToken(label)
          setCreated({ label: result.info.label, token: result.token })
        }}
      />
    </section>
  )
}
