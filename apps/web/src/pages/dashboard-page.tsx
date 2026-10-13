import type { ProjectSummary } from '@openleaf/shared'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  copyProject,
  deleteProject,
  patchProject,
  useProjects,
} from '@/api/projects'
import { AppHeader } from '@/features/common/app-header'
import { ConfirmModal } from '@/features/common/confirm-modal'
import { NamePromptModal } from '@/features/common/name-prompt-modal'
import { NewProjectMenu } from '@/features/dashboard/new-project-menu'
import {
  ProjectActions,
  type ProjectDialog,
} from '@/features/dashboard/project-actions'
import { showToast } from '@/features/toasts'
import { formatTimeBasedOnYear } from '@/features/utils/format-date'
import { useTranslation } from '@/i18n'
import LoadingSpinner from '@/shared/components/loading-spinner'
import MaterialIcon from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import OLFormControl from '@/shared/components/ol/ol-form-control'

type Tab = 'all' | 'archived' | 'trashed'
type SortKey = 'name' | 'updatedAt'
type Sort = { key: SortKey; descending: boolean }

const TAB_FILTERS: Record<Tab, (p: ProjectSummary) => boolean> = {
  all: p => !p.archivedAt && !p.trashedAt,
  archived: p => !!p.archivedAt && !p.trashedAt,
  trashed: p => !!p.trashedAt,
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export default function DashboardPage() {
  const { t } = useTranslation()
  const projects = useProjects()
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'updatedAt', descending: true })
  const [dialog, setDialog] = useState<ProjectDialog | null>(null)

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (projects.data ?? []).filter(
      p => TAB_FILTERS[tab](p) && p.name.toLowerCase().includes(needle)
    )
    list.sort((a, b) => {
      const order =
        sort.key === 'name'
          ? collator.compare(a.name, b.name)
          : a.updatedAt - b.updatedAt
      return sort.descending ? -order : order
    })
    return list
  }, [projects.data, tab, search, sort])

  const toggleSort = (key: SortKey) =>
    setSort(current =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: key === 'updatedAt' }
    )

  const sortHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      className="table-header-sort-btn"
      onClick={() => toggleSort(key)}
      aria-label={t('sort_by_x', { x: label })}
    >
      {label}
      {sort.key === key && (
        <MaterialIcon
          type={sort.descending ? 'arrow_drop_down' : 'arrow_drop_up'}
        />
      )}
    </button>
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('all_projects') },
    { key: 'archived', label: t('archived_projects') },
    { key: 'trashed', label: t('trashed_projects') },
  ]

  return (
    <div className="openleaf-page">
      <AppHeader />
      <main className="container openleaf-dashboard">
        <div className="openleaf-dashboard-toolbar">
          <h1 className="h3 mb-0">{t('projects')}</h1>
          <NewProjectMenu />
        </div>
        <div className="openleaf-dashboard-filters">
          <div className="ol-tabs">
            <div className="nav-tabs-container">
              <ul className="nav nav-tabs align-left">
                {tabs.map(({ key, label }) => (
                  <li key={key}>
                    <button
                      type="button"
                      aria-pressed={tab === key}
                      className={tab === key ? 'active' : undefined}
                      onClick={() => setTab(key)}
                      data-testid={`projects-tab-${key}`}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <OLFormControl
            type="search"
            className="openleaf-dashboard-search"
            placeholder={t('search_projects')}
            aria-label={t('search_projects')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            prepend={<MaterialIcon type="search" />}
          />
        </div>

        {projects.isPending ? (
          <LoadingSpinner className="py-5" />
        ) : projects.isError ? (
          <Notification type="error" content={projects.error.message} />
        ) : (
          <table
            className="table project-dash-table"
            data-testid="project-table"
          >
            <thead>
              <tr>
                <th className="dash-cell-name">
                  {sortHeader('name', t('title'))}
                </th>
                <th className="dash-cell-owner">{t('owner')}</th>
                <th className="dash-cell-date">
                  {sortHeader('updatedAt', t('last_modified'))}
                </th>
                <th className="dash-cell-actions">
                  <span className="visually-hidden">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr className="no-projects">
                  <td colSpan={4} className="text-center py-5 text-muted">
                    {t('no_projects')}
                  </td>
                </tr>
              ) : (
                visible.map(project => (
                  <tr key={project.id} data-testid="project-row">
                    <td className="dash-cell-name">
                      <Link to={`/project/${project.id}`}>{project.name}</Link>
                    </td>
                    <td className="dash-cell-owner">
                      {project.role === 'owner' ? t('you') : project.ownerName}
                    </td>
                    <td className="dash-cell-date">
                      {formatTimeBasedOnYear(project.updatedAt)}
                    </td>
                    <td className="dash-cell-actions">
                      <ProjectActions project={project} onDialog={setDialog} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </main>

      <NamePromptModal
        show={dialog?.kind === 'rename'}
        title={t('rename_project')}
        label={t('project_name')}
        initialValue={dialog?.project.name ?? ''}
        submitLabel={t('rename')}
        testId="rename-project-modal"
        onHide={() => setDialog(null)}
        onSubmit={async name => {
          if (dialog) await patchProject(dialog.project.id, { name })
        }}
      />
      <NamePromptModal
        show={dialog?.kind === 'copy'}
        title={t('copy_project')}
        label={t('project_name')}
        initialValue={
          dialog ? t('copy_of_x', { name: dialog.project.name }) : ''
        }
        submitLabel={t('copy')}
        testId="copy-project-modal"
        onHide={() => setDialog(null)}
        onSubmit={async name => {
          if (!dialog) return
          await copyProject(dialog.project.id, name)
          showToast({ type: 'success', content: t('project_copied') })
        }}
      />
      <ConfirmModal
        show={dialog?.kind === 'delete'}
        title={t('delete_forever')}
        confirmLabel={t('delete_forever')}
        danger
        testId="delete-project-modal"
        onHide={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog) await deleteProject(dialog.project.id)
        }}
      >
        <p>
          {t('delete_project_forever_confirm', { name: dialog?.project.name })}
        </p>
        <p className="mb-0 text-danger">{t('this_action_cannot_be_undone')}</p>
      </ConfirmModal>
    </div>
  )
}
