import classNames from 'classnames'
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/api/client'
import { uploadConflicts, uploadFiles } from '@/api/tree'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import { formatBytes } from '@/utils/format-bytes'

type RowStatus = 'uploading' | 'done' | 'conflict' | 'skipped' | 'error'

type Row = { key: number; file: File; status: RowStatus; error?: string }

let nextKey = 1

export function UploadModal({
  show,
  projectId,
  parentId,
  folderPath,
  maxUploadBytes,
  initialFiles,
  onHide,
}: {
  show: boolean
  projectId: string
  parentId: string
  /** Shown in the title; `''` is the project root. */
  folderPath: string
  maxUploadBytes: number
  /** Files dropped from the OS; uploaded as soon as the dialog opens. */
  initialFiles?: File[]
  onHide: () => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>([])
  const [dragOver, setDragOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const update = useCallback(
    (keys: number[], patch: Partial<Row>) =>
      setRows(current =>
        current.map(row =>
          keys.includes(row.key) ? { ...row, ...patch } : row
        )
      ),
    []
  )

  const uploadBatch = useCallback(
    async (batch: Row[]) => {
      if (batch.length === 0) return
      const keys = batch.map(r => r.key)
      try {
        await uploadFiles(
          projectId,
          parentId,
          batch.map(r => r.file),
          { overwrite: false }
        )
        update(keys, { status: 'done' })
      } catch (err) {
        const clashing = new Set(uploadConflicts(err).map(c => c.name))
        const conflicts = batch.filter(r => clashing.has(r.file.name))
        if (conflicts.length === 0) {
          update(keys, { status: 'error', error: errorMessage(err) })
          return
        }
        // Nothing was written: mark the clashes and retry the rest.
        update(
          conflicts.map(r => r.key),
          { status: 'conflict' }
        )
        await uploadBatch(batch.filter(r => !clashing.has(r.file.name)))
      }
    },
    [projectId, parentId, update]
  )

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const added: Row[] = files.map(file => ({
        key: nextKey++,
        file,
        status: file.size > maxUploadBytes ? 'error' : 'uploading',
        error:
          file.size > maxUploadBytes
            ? t('file_too_large_max_x', { size: formatBytes(maxUploadBytes) })
            : undefined,
      }))
      setRows(current => [...current, ...added])
      uploadBatch(added.filter(r => r.status === 'uploading'))
    },
    [maxUploadBytes, t, uploadBatch]
  )

  const replace = async (targets: Row[]) => {
    const keys = targets.map(r => r.key)
    update(keys, { status: 'uploading' })
    try {
      await uploadFiles(
        projectId,
        parentId,
        targets.map(r => r.file),
        { overwrite: true }
      )
      update(keys, { status: 'done' })
    } catch (err) {
      update(keys, { status: 'error', error: errorMessage(err) })
    }
  }

  // OS drops open the dialog with files attached; upload each list once.
  const consumed = useRef<File[] | undefined>(undefined)
  useEffect(() => {
    if (!show || !initialFiles?.length || consumed.current === initialFiles)
      return
    consumed.current = initialFiles
    addFiles(initialFiles)
  }, [show, initialFiles, addFiles])

  // Close once everything is uploaded or skipped.
  useEffect(() => {
    if (
      rows.length > 0 &&
      rows.every(r => r.status === 'done' || r.status === 'skipped')
    ) {
      onHide()
    }
  }, [rows, onHide])

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    addFiles([...event.dataTransfer.files])
  }

  const conflicts = rows.filter(r => r.status === 'conflict')
  const busy = rows.some(row => row.status === 'uploading')

  return (
    <OLModal
      show={show}
      onHide={() => {
        if (!busy) onHide()
      }}
      onExited={() => setRows([])}
      data-testid="upload-modal"
    >
      <OLModalHeader>
        <OLModalTitle>
          {folderPath
            ? t('upload_files_to_x', { folder: folderPath })
            : t('upload_files')}
        </OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; keyboard users pick files with the button inside */}
        <div
          className={classNames('openleaf-dropzone', { 'drag-over': dragOver })}
          onDragOver={event => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          data-testid="upload-dropzone"
        >
          <MaterialIcon type="upload" size="2x" />
          <p className="mb-2">{t('drag_files_here_or')}</p>
          <OLButton variant="secondary" onClick={() => input.current?.click()}>
            {t('select_files')}
          </OLButton>
          <input
            ref={input}
            type="file"
            multiple
            className="d-none"
            data-testid="upload-input"
            aria-label={t('select_files')}
            onChange={event => {
              addFiles([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
        </div>

        {rows.length > 0 && (
          <ul className="list-group mt-3 openleaf-upload-list">
            {rows.map(row => (
              <li
                key={row.key}
                className="list-group-item d-block"
                data-testid="upload-row"
                data-status={row.status}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="flex-grow-1 text-truncate" translate="no">
                    {row.file.name}
                  </span>
                  <span className="text-muted small">
                    {formatBytes(row.file.size)}
                  </span>
                  {row.status === 'uploading' && <OLSpinner size="sm" />}
                  {row.status === 'done' && (
                    <MaterialIcon
                      type="check_circle"
                      className="text-success"
                    />
                  )}
                  {row.status === 'skipped' && (
                    <span className="small text-muted">{t('skipped')}</span>
                  )}
                  {row.status === 'conflict' && (
                    <>
                      <OLButton
                        size="sm"
                        variant="danger"
                        onClick={() => replace([row])}
                      >
                        {t('replace')}
                      </OLButton>
                      <OLButton
                        size="sm"
                        variant="secondary"
                        onClick={() => update([row.key], { status: 'skipped' })}
                      >
                        {t('skip')}
                      </OLButton>
                    </>
                  )}
                </div>
                {row.status === 'conflict' && (
                  <div className="small text-warning">
                    {t('file_already_exists_in_folder')}
                  </div>
                )}
                {row.status === 'error' && (
                  <div className="small text-danger">{row.error}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </OLModalBody>
      <OLModalFooter>
        {conflicts.length > 1 && (
          <>
            <OLButton
              variant="secondary"
              onClick={() =>
                update(
                  conflicts.map(r => r.key),
                  { status: 'skipped' }
                )
              }
            >
              {t('skip_all')}
            </OLButton>
            <OLButton variant="danger" onClick={() => replace(conflicts)}>
              {t('replace_all')}
            </OLButton>
          </>
        )}
        <OLButton variant="secondary" onClick={onHide} disabled={busy}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
