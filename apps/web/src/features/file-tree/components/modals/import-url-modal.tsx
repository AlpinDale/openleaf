import { type TreeEntry, validateEntryName } from '@openleaf/shared'
import { type FormEvent, useEffect, useState } from 'react'
import { errorMessage } from '@/api/client'
import { importUrl } from '@/api/tree'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

/** Last path segment of a URL, used as the default file name. */
function nameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : ''
  } catch {
    return ''
  }
}

export function ImportUrlModal({
  show,
  projectId,
  parentId,
  onHide,
  onImported,
}: {
  show: boolean
  projectId: string
  parentId: string
  onHide: () => void
  onImported: (entry: TreeEntry) => void
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (show) {
      setUrl('')
      setName('')
      setNameTouched(false)
      setError(null)
    }
  }, [show])

  const trimmedName = name.trim()
  const nameProblem = trimmedName ? validateEntryName(trimmedName) : null

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !trimmedName || nameProblem) return
    setBusy(true)
    setError(null)
    try {
      const entry = await importUrl(
        projectId,
        parentId,
        trimmedName,
        url.trim()
      )
      onImported(entry)
      onHide()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OLModal
      show={show}
      onHide={() => {
        if (!busy) onHide()
      }}
      data-testid="import-url-modal"
    >
      <OLForm onSubmit={onSubmit}>
        <OLModalHeader>
          <OLModalTitle>{t('from_external_url')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <OLFormGroup controlId="import-url">
            <OLFormLabel>{t('url_to_fetch_the_file_from')}</OLFormLabel>
            <OLFormControl
              type="url"
              required
              autoFocus
              placeholder="https://example.com/my-file.png"
              value={url}
              onChange={e => {
                setUrl(e.target.value)
                if (!nameTouched) setName(nameFromUrl(e.target.value))
              }}
            />
          </OLFormGroup>
          <OLFormGroup controlId="import-url-name">
            <OLFormLabel>{t('file_name_in_this_project')}</OLFormLabel>
            <OLFormControl
              required
              value={name}
              isInvalid={!!nameProblem}
              onChange={e => {
                setName(e.target.value)
                setNameTouched(true)
              }}
            />
            {nameProblem && (
              <div className="invalid-feedback d-block">{nameProblem}</div>
            )}
          </OLFormGroup>
          {error && <Notification type="error" content={error} />}
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={onHide} disabled={busy}>
            {t('cancel')}
          </OLButton>
          <OLButton
            type="submit"
            variant="primary"
            isLoading={busy}
            disabled={!url.trim() || !trimmedName || !!nameProblem}
          >
            {t('create')}
          </OLButton>
        </OLModalFooter>
      </OLForm>
    </OLModal>
  )
}
