import type { ProjectSummary } from '@openleaf/shared'
import { useNavigate } from 'react-router'
import { errorMessage } from '@/api/client'
import {
  type ProjectStateAction,
  projectZipUrl,
  setProjectState,
} from '@/api/projects'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'

export type ProjectDialog = {
  kind: 'rename' | 'copy' | 'delete'
  project: ProjectSummary
}

export function ProjectActions({
  project,
  onDialog,
}: {
  project: ProjectSummary
  onDialog: (dialog: ProjectDialog) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isOwner = project.role === 'owner'

  const run = async (action: ProjectStateAction) => {
    try {
      await setProjectState(project.id, action)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  return (
    <OLDropdown align="end">
      <OLDropdownToggle
        id={`project-actions-${project.id}`}
        variant="ghost"
        size="sm"
        className="openleaf-icon-toggle"
        aria-label={t('actions')}
        data-testid="project-actions"
      >
        <MaterialIcon type="more_vert" />
      </OLDropdownToggle>
      <OLDropdownMenu>
        <OLDropdownItem
          as="button"
          leadingIcon="open_in_new"
          onClick={() => navigate(`/project/${project.id}`)}
        >
          {t('open_project')}
        </OLDropdownItem>
        {isOwner && (
          <OLDropdownItem
            as="button"
            leadingIcon="edit"
            onClick={() => onDialog({ kind: 'rename', project })}
          >
            {t('rename')}
          </OLDropdownItem>
        )}
        <OLDropdownItem
          as="button"
          leadingIcon="content_copy"
          onClick={() => onDialog({ kind: 'copy', project })}
        >
          {t('make_a_copy')}
        </OLDropdownItem>
        <OLDropdownItem
          href={projectZipUrl(project.id)}
          download
          leadingIcon="download"
        >
          {t('download_zip_file')}
        </OLDropdownItem>
        {isOwner && <OLDropdownDivider />}
        {isOwner && !project.trashedAt && (
          <OLDropdownItem
            as="button"
            leadingIcon={project.archivedAt ? 'unarchive' : 'inbox'}
            onClick={() => run(project.archivedAt ? 'unarchive' : 'archive')}
          >
            {project.archivedAt ? t('unarchive') : t('archive')}
          </OLDropdownItem>
        )}
        {isOwner && (
          <OLDropdownItem
            as="button"
            leadingIcon={project.trashedAt ? 'restore_from_trash' : 'delete'}
            onClick={() => run(project.trashedAt ? 'restore' : 'trash')}
          >
            {project.trashedAt ? t('restore') : t('trash')}
          </OLDropdownItem>
        )}
        {isOwner && project.trashedAt && (
          <OLDropdownItem
            as="button"
            variant="danger"
            leadingIcon="delete_forever"
            onClick={() => onDialog({ kind: 'delete', project })}
          >
            {t('delete_forever')}
          </OLDropdownItem>
        )}
      </OLDropdownMenu>
    </OLDropdown>
  )
}
