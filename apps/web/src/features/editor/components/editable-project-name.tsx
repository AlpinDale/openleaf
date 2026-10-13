// Adapted from Overleaf services/web/frontend/js/features/ide-react/components/toolbar/project-title.tsx (AGPL-3.0).
import type { ProjectDetails } from '@openleaf/shared'
import { useState } from 'react'
import { errorMessage } from '@/api/client'
import { patchProject } from '@/api/projects'
import { useCommandRegistryStore } from '@/features/ide-react/context/command-registry-context'
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

/** Registry commands offered in the title dropdown (registered by the menu bar). */
const DOWNLOAD_COMMANDS = [
  'download-pdf',
  'download-as-source-zip',
  'export-as-docx',
  'export-as-markdown',
  'export-as-html',
]

function CommandItem({ id }: { id: string }) {
  const command = useCommandRegistryStore(s => s.registry.get(id))
  if (!command?.handler) return null
  return (
    <li role="none">
      <OLDropdownItem
        as="button"
        disabled={command.disabled}
        onClick={() => command.handler?.({ location: 'project-title' })}
        data-testid={`project-title-${id}`}
      >
        {command.menuLabel ?? command.label}
      </OLDropdownItem>
    </li>
  )
}

/**
 * Project title in the top bar: a dropdown with downloads, exports, "Make a
 * copy" and (owner) "Rename", which turns the title into an input.
 * `readOnly` shows just the name (focus mode).
 */
export function EditableProjectName({
  project,
  readOnly = false,
}: {
  project: ProjectDetails
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(project.name)
  const canRename = project.role === 'owner'

  const finish = async (commit: boolean) => {
    setEditing(false)
    const name = value.trim()
    if (!commit || !name || name === project.name) return
    try {
      await patchProject(project.id, { name })
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  const title = (
    <span
      className="ide-redesign-toolbar-project-name"
      data-testid="project-name"
      translate="no"
    >
      {project.name}
    </span>
  )

  if (readOnly) {
    return <div className="openleaf-project-name">{title}</div>
  }

  if (editing) {
    return (
      <input
        className="form-control form-control-sm ide-redesign-toolbar-editable-project-name"
        aria-label={t('project_name')}
        data-testid="project-name-input"
        // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to rename
        autoFocus
        maxLength={150}
        value={value}
        onChange={e => setValue(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            setValue(project.name)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <OLDropdown align="end" className="ide-redesign-toolbar-project-dropdown">
      <OLDropdownToggle
        id="project-title-options"
        aria-label={t('project_title_options')}
        className="ide-redesign-toolbar-project-dropdown-toggle ide-redesign-toolbar-dropdown-toggle-subdued fw-bold ide-redesign-toolbar-button-subdued"
        data-testid="project-title-dropdown"
      >
        {title}
        <MaterialIcon type="keyboard_arrow_down" />
      </OLDropdownToggle>
      <OLDropdownMenu renderOnMount>
        {DOWNLOAD_COMMANDS.map(id => (
          <CommandItem key={id} id={id} />
        ))}
        <OLDropdownDivider />
        <CommandItem id="copy_project" />
        <li role="none">
          <OLDropdownItem
            as="button"
            disabled={!canRename}
            onClick={() => {
              setValue(project.name)
              setEditing(true)
            }}
            data-testid="project-title-rename"
          >
            {t('rename')}
          </OLDropdownItem>
        </li>
      </OLDropdownMenu>
    </OLDropdown>
  )
}
