import {
  fileExtension,
  type ProjectDetails,
  roleAtLeast,
  type TreeEntry,
} from '@openleaf/shared'
import { type ReactNode, useState } from 'react'
import { errorMessage } from '@/api/client'
import { fileUrl, refreshEntry } from '@/api/tree'
import { showToast } from '@/features/toasts'
import { formatTimeBasedOnYear } from '@/features/utils/format-date'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import { formatBytes } from '@/utils/format-bytes'
import { PdfFirstPage } from './pdf-first-page'

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'avif',
])

/** Preview of a binary file entry in the editor panel. */
export function FileView({
  project,
  entry,
}: {
  project: ProjectDetails
  entry: TreeEntry
}) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const extension = fileExtension(entry.name)
  // `updatedAt` busts the browser cache after a replace or refresh.
  const url = `${fileUrl(project.id, entry.id)}?v=${entry.updatedAt}`
  const canRefresh = !!entry.sourceUrl && roleAtLeast(project.role, 'editor')

  const refresh = async () => {
    setRefreshing(true)
    try {
      await refreshEntry(project.id, entry.id)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    } finally {
      setRefreshing(false)
    }
  }

  let preview: ReactNode
  if (IMAGE_EXTENSIONS.has(extension)) {
    preview = <img src={url} alt={entry.name} data-testid="file-view-image" />
  } else if (extension === 'pdf') {
    preview = <PdfFirstPage key={url} url={url} />
  } else {
    preview = (
      <p className="no-preview" data-testid="file-view-no-preview">
        {t('no_preview_available')}
      </p>
    )
  }

  return (
    <div className="file-view full-size" data-testid="file-view">
      <div className="file-view-header mb-3">
        <h2 className="h5 mb-1" translate="no">
          {entry.sourceUrl && (
            <MaterialIcon type="link" className="linked-file-icon me-1" />
          )}
          {entry.name}
        </h2>
        <div className="text-muted small">
          {formatBytes(entry.size)} · {t('last_updated')}{' '}
          {formatTimeBasedOnYear(entry.updatedAt)}
        </div>
        {entry.sourceUrl && (
          <div className="small mt-1" data-testid="file-view-source-url">
            {t('imported_from')}{' '}
            <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
              {entry.sourceUrl}
            </a>
          </div>
        )}
        <div className="file-view-buttons mt-2">
          {canRefresh && (
            <OLButton
              variant="primary"
              size="sm"
              leadingIcon="refresh"
              isLoading={refreshing}
              onClick={refresh}
              data-testid="file-view-refresh"
            >
              {t('refresh')}
            </OLButton>
          )}
          <OLButton
            variant="secondary"
            size="sm"
            leadingIcon="download"
            href={fileUrl(project.id, entry.id)}
            download={entry.name}
          >
            {t('download')}
          </OLButton>
        </div>
      </div>
      {preview}
    </div>
  )
}
