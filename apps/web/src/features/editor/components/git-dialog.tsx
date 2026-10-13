import type { ProjectDetails } from '@openleaf/shared'
import { useState } from 'react'
import { Link } from 'react-router'
import { Trans, useTranslation } from '@/i18n'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

/** Top-bar Git button and the clone-URL dialog. */
export function GitButton({ project }: { project: ProjectDetails }) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const command = `git clone ${project.gitUrl}`
  return (
    <>
      <OLButton
        variant="ghost"
        size="sm"
        className="ide-redesign-toolbar-button-subdued"
        leadingIcon="commit"
        data-testid="git-button"
        onClick={() => setShow(true)}
      >
        {t('git')}
      </OLButton>
      <OLModal
        show={show}
        onHide={() => setShow(false)}
        data-testid="git-dialog"
      >
        <OLModalHeader closeButton>
          <OLModalTitle>{t('clone_with_git')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <p>{t('git_clone_intro')}</p>
          <div className="openleaf-git-clone-command">
            <code data-testid="git-clone-command">{command}</code>
            <CopyToClipboard content={command} tooltipId="git-clone-copy" />
          </div>
          <p>
            <Trans
              i18nKey="git_clone_credentials"
              components={{
                link: <Link to="/settings" target="_blank" rel="noopener" />,
              }}
            />
          </p>
          <p className="mb-0">{t('git_clone_sync_rules')}</p>
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={() => setShow(false)}>
            {t('close')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}
