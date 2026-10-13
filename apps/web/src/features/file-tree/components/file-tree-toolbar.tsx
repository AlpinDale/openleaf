import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

function ToolbarButton({
  id,
  icon,
  label,
  onClick,
}: {
  id: string
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <OLTooltip
      id={id}
      description={label}
      overlayProps={{ placement: 'bottom' }}
    >
      <OLIconButton
        variant="ghost"
        size="sm"
        icon={icon}
        accessibilityLabel={label}
        onClick={onClick}
        data-testid={id}
      />
    </OLTooltip>
  )
}

export function FileTreeToolbar({
  readOnly,
  onNewFile,
  onNewFolder,
  onUpload,
  onImportUrl,
  onImportProject,
}: {
  readOnly: boolean
  onNewFile: () => void
  onNewFolder: () => void
  onUpload: () => void
  onImportUrl: () => void
  onImportProject: () => void
}) {
  const { t } = useTranslation()
  if (readOnly) return null
  return (
    <div
      className="openleaf-file-tree-toolbar"
      role="toolbar"
      aria-label={t('project_files')}
    >
      <ToolbarButton
        id="file-tree-new-file"
        icon="note_add"
        label={t('new_file')}
        onClick={onNewFile}
      />
      <ToolbarButton
        id="file-tree-new-folder"
        icon="create_new_folder"
        label={t('new_folder')}
        onClick={onNewFolder}
      />
      <ToolbarButton
        id="file-tree-upload"
        icon="upload"
        label={t('upload')}
        onClick={onUpload}
      />
      <OLDropdown>
        <OLDropdownToggle
          id="file-tree-import"
          variant="ghost"
          size="sm"
          className="openleaf-icon-toggle"
          aria-label={t('import')}
          data-testid="file-tree-import"
        >
          <MaterialIcon type="add_link" />
        </OLDropdownToggle>
        <OLDropdownMenu>
          <OLDropdownItem as="button" onClick={onImportUrl} leadingIcon="link">
            {t('from_external_url')}
          </OLDropdownItem>
          <OLDropdownItem
            as="button"
            onClick={onImportProject}
            leadingIcon="folder_copy"
          >
            {t('from_another_project')}
          </OLDropdownItem>
        </OLDropdownMenu>
      </OLDropdown>
    </div>
  )
}
