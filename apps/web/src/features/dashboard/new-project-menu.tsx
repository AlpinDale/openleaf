import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '@/api/client'
import { createProject, importProjectZip } from '@/api/projects'
import { NamePromptModal } from '@/features/common/name-prompt-modal'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLSpinner from '@/shared/components/ol/ol-spinner'

type Template = 'blank' | 'example'

export function NewProjectMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<Template | null>(null)
  const [importing, setImporting] = useState(false)
  const zipInput = useRef<HTMLInputElement>(null)

  const onZipChosen = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const id = await importProjectZip(file)
      navigate(`/project/${id}`)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    } finally {
      setImporting(false)
      if (zipInput.current) zipInput.current.value = ''
    }
  }

  return (
    <>
      <OLDropdown className="new-project-dropdown">
        <OLDropdownToggle
          id="new-project-toggle"
          variant="primary"
          className="new-project-button"
          disabled={importing}
          data-testid="new-project-menu"
        >
          {importing && <OLSpinner size="sm" className="me-2" />}
          {t('new_project')}
        </OLDropdownToggle>
        <OLDropdownMenu>
          <OLDropdownItem
            as="button"
            onClick={() => setTemplate('blank')}
            data-testid="new-project-blank"
          >
            {t('blank_project')}
          </OLDropdownItem>
          <OLDropdownItem
            as="button"
            onClick={() => setTemplate('example')}
            data-testid="new-project-example"
          >
            {t('example_project')}
          </OLDropdownItem>
          <OLDropdownItem
            as="button"
            onClick={() => zipInput.current?.click()}
            data-testid="new-project-upload"
          >
            {t('upload_project')}
          </OLDropdownItem>
        </OLDropdownMenu>
      </OLDropdown>
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        className="d-none"
        data-testid="upload-project-input"
        onChange={e => onZipChosen(e.target.files?.[0])}
      />
      <NamePromptModal
        show={template !== null}
        title={template === 'example' ? t('example_project') : t('new_project')}
        label={t('project_name')}
        submitLabel={t('create')}
        testId="new-project-modal"
        onHide={() => setTemplate(null)}
        onSubmit={async name => {
          const id = await createProject(name, template ?? 'blank')
          navigate(`/project/${id}`)
        }}
      />
    </>
  )
}
