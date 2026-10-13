import type { HistoryLabel, HistoryVersion } from '@openleaf/shared'
import classNames from 'classnames'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/i18n'
import DropdownMenuItem from '@/shared/components/dropdown/dropdown-menu-item'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLOverlay from '@/shared/components/ol/ol-overlay'
import OLPopover from '@/shared/components/ol/ol-popover'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

/** What the per-version ⋮ menu can do; `oid` is the row's version. */
export type VersionActions = {
  canEdit: boolean
  newestOid: string | null
  canCompareFrom: (oid: string) => boolean
  canCompareUpTo: (oid: string) => boolean
  compareFrom: (oid: string) => void
  compareUpTo: (oid: string) => void
  addLabel: (oid: string) => void
  restore: (oid: string) => void
  downloadUrl: (oid: string) => string
}

/** Port of Overleaf's history `ActionsDropdown` + `HistoryDropdownContent`. */
function VersionActionsDropdown({
  oid,
  actions,
}: {
  oid: string
  actions: VersionActions
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps menu clicks from selecting the row
    <div
      className="float-end"
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <OLDropdown align="end" show={open} onToggle={setOpen}>
        <OLTooltip
          id={`history-version-dropdown-${oid}`}
          description={t('more_actions')}
          overlayProps={{ placement: 'bottom' }}
          hidden={open}
        >
          <span>
            <OLDropdownToggle
              id={`history-version-dropdown-toggle-${oid}`}
              className="history-version-dropdown-menu-btn no-default-caret"
              as="button"
              data-testid="history-version-actions"
              aria-label={t('more_actions')}
            >
              <MaterialIcon type="more_vert" />
            </OLDropdownToggle>
          </span>
        </OLTooltip>
        <OLDropdownMenu className="history-version-dropdown-menu">
          <DropdownMenuItem
            as="button"
            disabled={!actions.canCompareFrom(oid)}
            leadingIcon={
              <MaterialIcon
                type="align_end"
                className="history-dropdown-icon"
              />
            }
            data-testid="history-compare-from"
            onClick={() => {
              setOpen(false)
              actions.compareFrom(oid)
            }}
          >
            {t('history_compare_from_this_version')}
          </DropdownMenuItem>
          <DropdownMenuItem
            as="button"
            disabled={!actions.canCompareUpTo(oid)}
            leadingIcon={
              <MaterialIcon
                type="align_start"
                className="history-dropdown-icon"
              />
            }
            data-testid="history-compare-up-to"
            onClick={() => {
              setOpen(false)
              actions.compareUpTo(oid)
            }}
          >
            {t('history_compare_up_to_this_version')}
          </DropdownMenuItem>
          <OLDropdownDivider />
          {actions.canEdit && (
            <DropdownMenuItem
              as="button"
              leadingIcon="label"
              data-testid="history-version-add-label"
              onClick={() => {
                setOpen(false)
                actions.addLabel(oid)
              }}
            >
              {t('history_label_this_version')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            href={actions.downloadUrl(oid)}
            download
            rel="noreferrer"
            leadingIcon="download"
            data-testid="history-version-download"
            onClick={() => setOpen(false)}
          >
            {t('history_download_this_version')}
          </DropdownMenuItem>
          {actions.canEdit && oid !== actions.newestOid && (
            <DropdownMenuItem
              as="button"
              leadingIcon="undo"
              data-testid="history-version-restore"
              onClick={() => {
                setOpen(false)
                actions.restore(oid)
              }}
            >
              {t('restore_this_version')}
            </DropdownMenuItem>
          )}
        </OLDropdownMenu>
      </OLDropdown>
    </div>
  )
}

function LabelBadge({
  label,
  canEdit,
  onDelete,
}: {
  label: HistoryLabel
  canEdit: boolean
  onDelete: (label: HistoryLabel) => void
}) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const target = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        type="button"
        ref={target}
        className="history-version-badge badge bg-info border-0"
        data-testid="history-label-badge"
        onClick={event => {
          event.stopPropagation()
          setShow(!show)
        }}
      >
        <MaterialIcon type="label" />
        <span className="history-version-label">{label.name}</span>
      </button>
      <OLOverlay
        show={show}
        target={target.current}
        placement="left"
        rootClose
        onHide={() => setShow(false)}
      >
        <OLPopover id={`label-${label.id}`} className="history-popover">
          <div>
            <strong>{label.name}</strong>
          </div>
          <div className="small">
            {t('history_label_created_by')} {label.userName},{' '}
            {new Date(label.createdAt).toLocaleString()}
          </div>
          {canEdit && (
            <OLButton
              variant="danger"
              size="sm"
              className="mt-2"
              data-testid="history-label-delete"
              onClick={event => {
                event.stopPropagation()
                setShow(false)
                onDelete(label)
              }}
            >
              {t('delete')}
            </OLButton>
          )}
        </OLPopover>
      </OLOverlay>
    </>
  )
}

export function HistoryVersionList({
  versions,
  selectedOids,
  compareFromOid,
  emptyMessage,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onDeleteLabel,
  actions,
}: {
  versions: HistoryVersion[]
  /** Versions whose changes are in the current diff. */
  selectedOids: Set<string>
  /** In compare mode, the version whose snapshot is the old side. */
  compareFromOid: string | null
  emptyMessage: string
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onSelect: (oid: string, extend: boolean) => void
  onDeleteLabel: (label: HistoryLabel) => void
  actions: VersionActions
}) {
  const { t } = useTranslation()
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoadMore()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  return (
    <div className="history-all-versions-scroller">
      <div className="history-all-versions-container">
        {versions.map((version, i) => {
          const showDay =
            i === 0 ||
            new Date(versions[i - 1].createdAt).toDateString() !==
              new Date(version.createdAt).toDateString()
          const selected = selectedOids.has(version.oid)
          const compareFrom = version.oid === compareFromOid
          return (
            <div key={version.oid}>
              {showDay && (
                <time className="history-version-day">
                  {new Date(version.createdAt).toLocaleDateString(undefined, {
                    dateStyle: 'long',
                  })}
                </time>
              )}
              {/* biome-ignore lint/a11y/useSemanticElements: row holds nested buttons */}
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                data-testid="history-version"
                data-oid={version.oid}
                data-compare-from={compareFrom || undefined}
                className={classNames('history-version-details', {
                  'version-element-selected': selected,
                  'version-element-within-selected': compareFrom,
                })}
                onClick={(event: MouseEvent) =>
                  onSelect(version.oid, event.shiftKey)
                }
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(version.oid, event.shiftKey)
                  }
                }}
              >
                <VersionActionsDropdown oid={version.oid} actions={actions} />
                <div className="history-version-main-details">
                  <time className="history-version-metadata-time">
                    <b>
                      {new Date(version.createdAt).toLocaleTimeString(
                        undefined,
                        { timeStyle: 'short' }
                      )}
                    </b>
                  </time>
                  {version.labels.map(label => (
                    <LabelBadge
                      key={label.id}
                      label={label}
                      canEdit={actions.canEdit}
                      onDelete={onDeleteLabel}
                    />
                  ))}
                  <div className="history-version-change-doc">
                    {version.message.split('\n')[0]}
                  </div>
                  <div className="history-version-changes">
                    {t('history_change_counts', {
                      added: version.changes.filter(c => c.op === 'added')
                        .length,
                      modified: version.changes.filter(c => c.op === 'modified')
                        .length,
                      deleted: version.changes.filter(c => c.op === 'deleted')
                        .length,
                    })}
                  </div>
                  <div className="history-version-metadata-users">
                    {version.authors.map(author => author.name).join(', ') ||
                      'OpenLeaf'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {versions.length === 0 && !hasMore && (
          <p className="history-version-details text-muted">{emptyMessage}</p>
        )}
        <div ref={sentinel} className="history-versions-bottom">
          {loadingMore && <OLSpinner size="sm" />}
        </div>
      </div>
    </div>
  )
}
