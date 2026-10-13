import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useFigureModalContext } from '../figure-modal-context'
import { useCurrentProjectFolders } from '../../../hooks/use-current-project-folders'
import { File } from '../../../utils/file'
import { uploadFiles } from '@/api/tree'
import { useProjectContext } from '@/shared/context/project-context'
import classNames from 'classnames'
import { FileRelocator } from '../file-relocator'
import { useTranslation } from '@/i18n'
import { useCodeMirrorViewContext } from '../../codemirror-context'
import { waitForFileTreeUpdate } from '../../../extensions/figure-modal'
import getMeta from '@/utils/meta'
import { replaceOnConflict } from './replace-on-conflict'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import OLSpinner from '@/shared/components/ol/ol-spinner'

/* eslint-disable no-unused-vars */
export enum FileUploadStatus {
  ERROR,
  SUCCESS,
  NOT_ATTEMPTED,
  UPLOADING,
}

/* eslint-enable no-unused-vars */

const ACCEPTED_TYPES = 'image/*,.pdf,.eps,.svg'

export const FigureModalUploadFileSource: FC = () => {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()
  const { dispatch, pastedImageData } = useFigureModalContext()
  const { projectId } = useProjectContext()
  const { rootFile } = useCurrentProjectFolders()
  const [folder, setFolder] = useState<File | null>(null)
  const [nameDirty, setNameDirty] = useState<boolean>(false)
  const [file, setFile] = useState<globalThis.File | null>(null)
  const [name, setName] = useState<string>('')
  const [uploading, setUploading] = useState<boolean>(false)
  const [uploadError, setUploadError] = useState<unknown>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const maxUploadSize = getMeta('ol-ExposedSettings')?.maxUploadSize

  const dispatchUploadAction = useCallback(
    (name?: string, file?: globalThis.File | null, folder?: File | null) => {
      if (!name || !file) {
        dispatch({ getPath: undefined })
        return
      }
      dispatch({
        getPath: async () => {
          const uploadFolder = folder ?? rootFile
          const fileTreeUpdate = waitForFileTreeUpdate(view)
          setUploading(true)
          setUploadError(null)
          try {
            const renamed = new globalThis.File([file], name, {
              type: file.type,
            })
            await replaceOnConflict(name, overwrite =>
              uploadFiles(projectId, uploadFolder.id, [renamed], { overwrite })
            )
          } catch (error) {
            setUploadError(error)
            throw error
          } finally {
            setUploading(false)
          }
          await fileTreeUpdate.withTimeout(500)
          return uploadFolder.path === '' && uploadFolder.name === 'rootFolder'
            ? `${name}`
            : `${uploadFolder.path ? uploadFolder.path + '/' : ''}${
                uploadFolder.name
              }/${name}`
        },
      })
    },
    [dispatch, rootFile, view, projectId]
  )

  const selectFile = useCallback(
    (selected: globalThis.File | undefined) => {
      if (!selected) return
      if (maxUploadSize && selected.size > maxUploadSize) {
        dispatch({ error: t('file_too_large') })
        return
      }
      const newName = nameDirty ? name : selected.name
      setName(newName)
      setFile(selected)
      dispatchUploadAction(newName, selected, folder)
    },
    [dispatch, dispatchUploadAction, folder, maxUploadSize, name, nameDirty, t]
  )

  useEffect(() => {
    if (pastedImageData) {
      selectFile(
        new globalThis.File([pastedImageData.data], pastedImageData.name, {
          type: pastedImageData.type,
        })
      )
    }
    // only when new pasted data arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedImageData])

  return (
    <>
      <OLFormGroup>
        <div className="figure-modal-upload">
          {file ? (
            <FileContainer
              name={file.name}
              size={file.size}
              status={
                uploading
                  ? FileUploadStatus.UPLOADING
                  : uploadError
                    ? FileUploadStatus.ERROR
                    : FileUploadStatus.NOT_ATTEMPTED
              }
              onDelete={() => {
                setFile(null)
                const newName = nameDirty ? name : ''
                setName(newName)
                dispatchUploadAction(newName, null, folder)
              }}
            />
          ) : (
            <div
              className={classNames('figure-modal-dropzone', {
                'figure-modal-dropzone-active': dragging,
              })}
              onDragOver={event => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault()
                setDragging(false)
                selectFile(event.dataTransfer.files[0])
              }}
            >
              {t('drag_here_paste_an_image_or')}{' '}
              <OLButton
                variant="link"
                className="p-0 align-baseline"
                onClick={() => inputRef.current?.click()}
              >
                {t('select_from_your_computer')}
              </OLButton>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                hidden
                onChange={event => {
                  selectFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </div>
          )}
        </div>
      </OLFormGroup>
      <FileRelocator
        folder={folder}
        name={name}
        nameDisabled={!file && !nameDirty}
        onFolderChanged={item =>
          dispatchUploadAction(name, file, item ?? rootFile)
        }
        onNameChanged={name => dispatchUploadAction(name, file, folder)}
        setFolder={setFolder}
        setName={setName}
        setNameDirty={setNameDirty}
      />
    </>
  )
}

export const FileContainer: FC<{
  name: string
  size?: number
  status: FileUploadStatus
  onDelete?: () => any
}> = ({ name, size, status, onDelete }) => {
  const { t } = useTranslation()
  let icon = ''
  switch (status) {
    case FileUploadStatus.ERROR:
      icon = 'cancel'
      break
    case FileUploadStatus.SUCCESS:
      icon = 'check_circle'
      break
    case FileUploadStatus.NOT_ATTEMPTED:
      icon = 'imagesmode'
      break
  }

  return (
    <div className="file-container">
      <div className="file-container-file">
        <span
          className={classNames({
            'text-success': status === FileUploadStatus.SUCCESS,
            'text-danger': status === FileUploadStatus.ERROR,
          })}
        >
          {status === FileUploadStatus.UPLOADING ? (
            <OLSpinner size="sm" />
          ) : (
            <MaterialIcon type={icon} className="align-text-bottom" />
          )}
        </span>
        <div className="file-info">
          <span className="file-name" aria-label={t('file_name_figure_modal')}>
            {name}
          </span>
          {size !== undefined && <FileSize size={size} />}
        </div>
        <OLButton
          variant="link"
          className="p-0 text-decoration-none"
          aria-label={t('remove_or_replace_figure')}
          onClick={() => onDelete && onDelete()}
        >
          <MaterialIcon type="cancel" className="icon-danger" />
        </OLButton>
      </div>
    </div>
  )
}

const FileSize: FC<{ size: number; className?: string }> = ({
  size,
  className,
}) => {
  const { t } = useTranslation()
  const BYTE_UNITS: [string, number][] = [
    ['B', 1],
    ['KB', 1e3],
    ['MB', 1e6],
    ['GB', 1e9],
    ['TB', 1e12],
    ['PB', 1e15],
  ]
  const labelIndex =
    size > 0
      ? Math.min(Math.floor(Math.log10(size) / 3), BYTE_UNITS.length - 1)
      : 0

  const [label, bytesPerUnit] = BYTE_UNITS[labelIndex]
  const sizeInUnits = Math.round(size / bytesPerUnit)
  return (
    <small aria-label={t('file_size')} className={className}>
      {sizeInUnits} {label}
    </small>
  )
}
