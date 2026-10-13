import { type TreeEntry, validateEntryName } from '@openleaf/shared'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { errorMessage } from '@/api/client'
import { useProjects } from '@/api/projects'
import { importFromProject, useTree } from '@/api/tree'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { indexTree } from '../../util/tree-index'

function SourceEntrySelect({
  sourceProjectId,
  value,
  onChange,
}: {
  sourceProjectId: string
  value: string
  onChange: (entryId: string, name: string) => void
}) {
  const { t } = useTranslation()
  const tree = useTree(sourceProjectId)
  const options = useMemo(() => {
    if (!tree.data) return []
    const index = indexTree(tree.data)
    return tree.data.entries
      .filter(e => e.kind !== 'folder')
      .map(e => ({
        id: e.id,
        name: e.name,
        path: index.paths.get(e.id) ?? e.name,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [tree.data])

  if (tree.isError) {
    return <Notification type="error" content={tree.error.message} />
  }
  return (
    <OLFormGroup controlId="import-project-entry">
      <OLFormLabel>{t('select_a_file')}</OLFormLabel>
      <OLFormSelect
        required
        disabled={tree.isPending}
        value={value}
        onChange={e => {
          const option = options.find(o => o.id === e.target.value)
          onChange(e.target.value, option?.name ?? '')
        }}
      >
        <option value="" disabled>
          {tree.isPending ? `${t('loading')}…` : t('select_a_file')}
        </option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.path}
          </option>
        ))}
      </OLFormSelect>
    </OLFormGroup>
  )
}

export function ImportProjectModal({
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
  const projects = useProjects()
  const [sourceProjectId, setSourceProjectId] = useState('')
  const [sourceEntryId, setSourceEntryId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (show) {
      setSourceProjectId('')
      setSourceEntryId('')
      setName('')
      setError(null)
    }
  }, [show])

  // The cached list may predate projects created elsewhere.
  const refetchProjects = projects.refetch
  useEffect(() => {
    if (show) refetchProjects()
  }, [show, refetchProjects])

  const sources = (projects.data ?? [])
    .filter(p => p.id !== projectId && !p.trashedAt)
    .sort((a, b) => a.name.localeCompare(b.name))

  const trimmedName = name.trim()
  const nameProblem = trimmedName ? validateEntryName(trimmedName) : null

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !sourceEntryId || !trimmedName || nameProblem) return
    setBusy(true)
    setError(null)
    try {
      const entry = await importFromProject(
        projectId,
        parentId,
        trimmedName,
        sourceProjectId,
        sourceEntryId
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
      data-testid="import-project-modal"
    >
      <OLForm onSubmit={onSubmit}>
        <OLModalHeader>
          <OLModalTitle>{t('from_another_project')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <OLFormGroup controlId="import-project-source">
            <OLFormLabel>{t('select_a_project')}</OLFormLabel>
            <OLFormSelect
              required
              disabled={projects.isPending}
              value={sourceProjectId}
              onChange={e => {
                setSourceProjectId(e.target.value)
                setSourceEntryId('')
              }}
            >
              <option value="" disabled>
                {t('select_a_project')}
              </option>
              {sources.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </OLFormSelect>
          </OLFormGroup>
          {sourceProjectId && (
            <SourceEntrySelect
              sourceProjectId={sourceProjectId}
              value={sourceEntryId}
              onChange={(entryId, entryName) => {
                setSourceEntryId(entryId)
                setName(entryName)
              }}
            />
          )}
          <OLFormGroup controlId="import-project-name">
            <OLFormLabel>{t('file_name_in_this_project')}</OLFormLabel>
            <OLFormControl
              required
              value={name}
              isInvalid={!!nameProblem}
              onChange={e => setName(e.target.value)}
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
            disabled={!sourceEntryId || !trimmedName || !!nameProblem}
          >
            {t('create')}
          </OLButton>
        </OLModalFooter>
      </OLForm>
    </OLModal>
  )
}
