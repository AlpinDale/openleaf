import {
  type HistoryLabel,
  type ProjectDetails,
  roleAtLeast,
} from '@openleaf/shared'
import classNames from 'classnames'
import { useCallback, useMemo, useRef, useState } from 'react'
import { errorMessage } from '@/api/client'
import {
  addHistoryLabel,
  deleteHistoryLabel,
  historyFileUrl,
  historyZipUrl,
  restoreHistoryVersion,
  useHistoryFileText,
  useHistoryLabels,
  useHistoryTree,
  useHistoryVersions,
} from '@/api/history'
import { ConfirmModal } from '@/features/common/confirm-modal'
import { NamePromptModal } from '@/features/common/name-prompt-modal'
import { useEditorStore } from '@/features/editor/editor-store'
import { showToast } from '@/features/toasts'
import { Trans, useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import {
  type ChangeOp,
  combineChanges,
  compareFrom,
  compareUpTo,
  type HistorySelection,
  resolveSelection,
} from '../selection'
import { HistoryDiffView } from './history-diff-view'
import { HistoryVersionList, type VersionActions } from './history-version-list'

const OP_BADGE: Record<ChangeOp, string> = {
  added: 'success',
  modified: 'info',
  deleted: 'danger',
}

const shortOid = (oid: string) => oid.slice(0, 7)

type HistoryDialog = {
  kind: 'restoreVersion' | 'restoreFile' | 'addLabel'
  oid: string
}

export function HistoryView({ project }: { project: ProjectDetails }) {
  const { t } = useTranslation()
  const projectId = project.id
  const canEdit = roleAtLeast(project.role, 'editor')
  const history = useHistoryVersions(projectId)
  const labels = useHistoryLabels(projectId)
  const [tab, setTab] = useState<'all' | 'labels'>('all')
  const [allFiles, setAllFiles] = useState(false)
  const [selection, setSelection] = useState<HistorySelection | null>(null)
  const [anchorOid, setAnchorOid] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [dialog, setDialog] = useState<HistoryDialog | null>(null)
  // Keeps the dialog's text stable while it animates out.
  const lastDialog = useRef<HistoryDialog | null>(null)
  if (dialog) lastDialog.current = dialog
  const shownDialog = dialog ?? lastDialog.current

  const versions = useMemo(
    () => history.data?.pages.flat() ?? [],
    [history.data]
  )
  const shownVersions = useMemo(() => {
    if (tab === 'all') return versions
    const labelled = new Set(labels.data?.map(label => label.commitOid))
    return versions.filter(version => labelled.has(version.oid))
  }, [versions, tab, labels.data])

  // Default to the newest version until the user picks one (or when the
  // picked versions are no longer in the list).
  const resolved = useMemo(
    () =>
      resolveSelection(versions, selection) ??
      (versions[0]
        ? resolveSelection(versions, {
            kind: 'range',
            newestOid: versions[0].oid,
            oldestOid: versions[0].oid,
          })
        : null),
    [versions, selection]
  )
  const selectedOids = useMemo(
    () => new Set(resolved?.versions.map(v => v.oid)),
    [resolved]
  )

  /** "<date, time> (<oid7>)", or "∅" before the first version. */
  const versionLabel = (oid: string | null) => {
    if (!oid) return '∅'
    const version = versions.find(v => v.oid === oid)
    const time = version
      ? `${new Date(version.createdAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })} `
      : ''
    return `${time}(${shortOid(oid)})`
  }

  const fromTree = useHistoryTree(projectId, resolved?.fromOid ?? null)
  const toTree = useHistoryTree(projectId, resolved?.toOid ?? null)
  const changes = useMemo(
    () => combineChanges(resolved?.versions ?? []),
    [resolved]
  )

  const fileList: { path: string; op: ChangeOp | null }[] = allFiles
    ? (toTree.data ?? [])
        .map(file => ({ path: file.path, op: changes.get(file.path) ?? null }))
        .sort((a, b) => a.path.localeCompare(b.path))
    : [...changes].map(([path, op]) => ({ path, op }))

  const activePath =
    selectedPath && fileList.some(file => file.path === selectedPath)
      ? selectedPath
      : (fileList[0]?.path ?? null)
  const toEntry = toTree.data?.find(file => file.path === activePath)
  const fromEntry = fromTree.data?.find(file => file.path === activePath)
  const treesLoaded = toTree.isSuccess && fromTree.isSuccess
  const isBinary = (toEntry ?? fromEntry)?.kind === 'binary' && treesLoaded
  const textEnabled = treesLoaded && !isBinary
  const fromText = useHistoryFileText(
    projectId,
    fromEntry ? (resolved?.fromOid ?? null) : null,
    activePath,
    textEnabled
  )
  const toText = useHistoryFileText(
    projectId,
    toEntry ? (resolved?.toOid ?? null) : null,
    activePath,
    textEnabled
  )

  const onSelect = (oid: string, extend: boolean) => {
    if (extend && anchorOid) {
      const a = versions.findIndex(v => v.oid === anchorOid)
      const b = versions.findIndex(v => v.oid === oid)
      if (a >= 0 && b >= 0) {
        setSelection({
          kind: 'range',
          newestOid: versions[Math.min(a, b)].oid,
          oldestOid: versions[Math.max(a, b)].oid,
        })
        return
      }
    }
    setAnchorOid(oid)
    setSelection({ kind: 'range', newestOid: oid, oldestOid: oid })
  }

  const versionActions: VersionActions = {
    canEdit,
    newestOid: versions[0]?.oid ?? null,
    canCompareFrom: oid => compareFrom(versions, resolved, oid) !== null,
    canCompareUpTo: oid => compareUpTo(versions, resolved, oid) !== null,
    compareFrom: oid => {
      const next = compareFrom(versions, resolved, oid)
      if (next) setSelection(next)
    },
    compareUpTo: oid => {
      const next = compareUpTo(versions, resolved, oid)
      if (next) setSelection(next)
    },
    addLabel: oid => setDialog({ kind: 'addLabel', oid }),
    restore: oid => setDialog({ kind: 'restoreVersion', oid }),
    downloadUrl: oid => historyZipUrl(projectId, oid),
  }

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = history
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const onDeleteLabel = async (label: HistoryLabel) => {
    try {
      await deleteHistoryLabel(projectId, label.id)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  const close = () => useEditorStore.getState().setHistoryOpen(false)
  const toOid = resolved?.toOid ?? null

  const restore = async (oid: string, path?: string) => {
    await restoreHistoryVersion(projectId, oid, path)
    close()
    showToast({
      type: 'success',
      content: path
        ? t('history_restored_file', { path, version: shortOid(oid) })
        : t('history_restored_version', { version: shortOid(oid) }),
    })
  }

  let centre: React.ReactNode
  if (history.isError) {
    centre = (
      <Notification
        type="error"
        className="history-error"
        content={errorMessage(history.error)}
      />
    )
  } else if (fromTree.isError || toTree.isError) {
    centre = (
      <Notification
        type="error"
        className="history-error"
        content={errorMessage(fromTree.error ?? toTree.error)}
      />
    )
  } else if (!resolved || !activePath) {
    centre = history.isPending ? (
      <div className="loading">
        <OLSpinner size="lg" />
      </div>
    ) : (
      <p className="p-4 text-muted">{t('history_no_file_selected')}</p>
    )
  } else if (!treesLoaded) {
    centre = (
      <div className="loading">
        <OLSpinner size="lg" />
      </div>
    )
  } else if (isBinary) {
    centre = (
      <div className="p-4" data-testid="history-binary-file">
        <p>{t('binary_file')}</p>
        <ul>
          {fromEntry && resolved.fromOid && (
            <li>
              <a
                href={historyFileUrl(projectId, resolved.fromOid, activePath)}
                download={activePath.split('/').pop()}
              >
                {t('history_download_at_version', {
                  version: shortOid(resolved.fromOid),
                })}
              </a>
            </li>
          )}
          {toEntry && (
            <li>
              <a
                href={historyFileUrl(projectId, resolved.toOid, activePath)}
                download={activePath.split('/').pop()}
              >
                {t('history_download_at_version', {
                  version: shortOid(resolved.toOid),
                })}
              </a>
            </li>
          )}
        </ul>
      </div>
    )
  } else if (fromText.isSuccess && toText.isSuccess) {
    centre = (
      <HistoryDiffView
        path={activePath}
        original={fromText.data}
        modified={toText.data}
      />
    )
  } else if (fromText.isError || toText.isError) {
    centre = (
      <Notification
        type="error"
        className="history-error"
        content={errorMessage(fromText.error ?? toText.error)}
      />
    )
  } else {
    centre = (
      <div className="loading">
        <OLSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="history-react openleaf-history" data-testid="history-view">
      <div className="history-file-tree openleaf-history-files">
        <div className="history-header openleaf-history-files-header">
          <OLFormSwitch
            id="history-all-files"
            label={t('all_files')}
            checked={allFiles}
            onChange={event => setAllFiles(event.target.checked)}
            data-testid="history-all-files"
          />
          <span>{t('all_files')}</span>
        </div>
        <ul className="history-file-tree-list" data-testid="history-files">
          {fileList.map(file => (
            <li
              key={file.path}
              className={classNames({ selected: file.path === activePath })}
            >
              {/* biome-ignore lint/a11y/useSemanticElements: styled tree row */}
              <div
                role="button"
                tabIndex={0}
                className="history-file-tree-item"
                data-testid="history-file"
                data-path={file.path}
                onClick={() => setSelectedPath(file.path)}
                onKeyDown={event => {
                  if (event.key === 'Enter') setSelectedPath(file.path)
                }}
              >
                <div className="history-file-tree-item-name-wrapper">
                  <span
                    className={classNames('history-file-tree-item-name', {
                      strikethrough: file.op === 'deleted',
                    })}
                  >
                    {file.path}
                  </span>
                  {file.op && (
                    <OLBadge
                      bg={OP_BADGE[file.op]}
                      className="history-file-tree-item-badge"
                    >
                      {t(file.op)}
                    </OLBadge>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="doc-panel">
        <div className="toolbar-container">
          <div className="history-react-toolbar">
            <span className="history-react-toolbar-file-info">
              {activePath}
              {resolved && (
                <span className="text-muted ms-2">
                  {resolved.fromOid ? shortOid(resolved.fromOid) : '∅'} →{' '}
                  {shortOid(resolved.toOid)}
                </span>
              )}
            </span>
            {canEdit && toOid && (
              <>
                <OLButton
                  variant="secondary"
                  size="sm"
                  disabled={!toEntry}
                  data-testid="history-restore-file"
                  onClick={() => setDialog({ kind: 'restoreFile', oid: toOid })}
                >
                  {t('restore_file')}
                </OLButton>
                <OLButton
                  variant="secondary"
                  size="sm"
                  data-testid="history-restore-version"
                  onClick={() =>
                    setDialog({ kind: 'restoreVersion', oid: toOid })
                  }
                >
                  {t('restore_this_version')}
                </OLButton>
                <OLButton
                  variant="secondary"
                  size="sm"
                  leadingIcon="label"
                  data-testid="history-add-label"
                  onClick={() => setDialog({ kind: 'addLabel', oid: toOid })}
                >
                  {t('history_label_this_version')}
                </OLButton>
              </>
            )}
            {toOid && (
              <OLButton
                variant="secondary"
                size="sm"
                leadingIcon="download"
                href={historyZipUrl(projectId, toOid)}
                download
                data-testid="history-download-zip"
              >
                {t('download')}
              </OLButton>
            )}
            <OLButton
              variant="primary"
              size="sm"
              data-testid="history-back-to-editor"
              onClick={close}
            >
              {t('back_to_editor')}
            </OLButton>
          </div>
          {resolved?.comparing && (
            <div
              className="openleaf-history-comparing"
              data-testid="history-comparing"
            >
              <Trans
                i18nKey="comparing_from_x_to_y"
                values={{
                  startTime: versionLabel(resolved.fromOid),
                  endTime: versionLabel(resolved.toOid),
                }}
                components={[<strong key="time" />]}
              />
            </div>
          )}
        </div>
        <div className="doc-container">{centre}</div>
      </div>
      <div className="change-list">
        <div className="history-header history-toggle-switch-container">
          <fieldset className="toggle-switch" data-testid="history-tabs">
            <legend className="visually-hidden">
              {t('history_view_a11y_description')}
            </legend>
            <input
              type="radio"
              name="history-tab"
              id="history-tab-all"
              className="toggle-switch-input"
              checked={tab === 'all'}
              onChange={() => setTab('all')}
            />
            <label
              htmlFor="history-tab-all"
              className="toggle-switch-label"
              data-testid="history-tab-all"
            >
              <span>{t('history_view_all')}</span>
            </label>
            <input
              type="radio"
              name="history-tab"
              id="history-tab-labels"
              className="toggle-switch-input"
              checked={tab === 'labels'}
              onChange={() => setTab('labels')}
            />
            <label
              htmlFor="history-tab-labels"
              className="toggle-switch-label"
              data-testid="history-tab-labels"
            >
              <span>{t('history_view_labels')}</span>
            </label>
          </fieldset>
        </div>
        <div className="history-version-list-container">
          <HistoryVersionList
            versions={shownVersions}
            selectedOids={selectedOids}
            compareFromOid={resolved?.comparing ? resolved.fromOid : null}
            emptyMessage={
              tab === 'labels'
                ? t('history_no_labels')
                : t('history_no_versions')
            }
            hasMore={!!hasNextPage}
            loadingMore={isFetchingNextPage || history.isPending}
            onLoadMore={loadMore}
            onSelect={onSelect}
            onDeleteLabel={onDeleteLabel}
            actions={versionActions}
          />
        </div>
      </div>
      <ConfirmModal
        show={
          dialog?.kind === 'restoreVersion' || dialog?.kind === 'restoreFile'
        }
        title={
          shownDialog?.kind === 'restoreFile'
            ? t('restore_file')
            : t('restore_this_version')
        }
        confirmLabel={t('restore')}
        confirmTestId="history-restore-confirm"
        testId="history-restore-dialog"
        onConfirm={() => {
          if (!dialog) return
          return restore(
            dialog.oid,
            dialog.kind === 'restoreFile'
              ? (activePath ?? undefined)
              : undefined
          )
        }}
        onHide={() => setDialog(null)}
      >
        {shownDialog?.kind === 'restoreFile'
          ? t('history_restore_file_confirm', {
              path: activePath ?? '',
              version: shortOid(shownDialog.oid),
            })
          : t('history_restore_version_confirm', {
              version: shownDialog ? shortOid(shownDialog.oid) : '',
            })}
      </ConfirmModal>
      <NamePromptModal
        show={dialog?.kind === 'addLabel'}
        title={t('history_label_this_version')}
        label={t('label')}
        submitLabel={t('history_add_label')}
        maxLength={100}
        onSubmit={async name => {
          if (dialog) await addHistoryLabel(projectId, dialog.oid, name)
        }}
        onHide={() => setDialog(null)}
      />
    </div>
  )
}
