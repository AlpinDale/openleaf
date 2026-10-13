import classNames from 'classnames'
import { type ReactNode, useState } from 'react'
import { useTranslation } from '@/i18n'
import HumanReadableLogsHints from '@/ide/human-readable-logs/HumanReadableLogsHints'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { goToLogEntry, useCompileStore } from '../compile-store'
import type { ErrorLevel, LogEntry } from '../util/types'

const LOG_PREVIEW_LIMIT = 100

type TabKey = 'all' | 'errors' | 'warnings' | 'typesetting'

function LogEntryCard({
  entry,
  level,
  title,
  autoExpand = false,
  rawContent,
  showLocation = true,
}: {
  entry?: LogEntry
  level: ErrorLevel
  title: ReactNode
  autoExpand?: boolean
  rawContent?: string
  showLocation?: boolean
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(!autoExpand)
  const hint = entry?.ruleId ? HumanReadableLogsHints[entry.ruleId] : undefined
  const file = showLocation ? entry?.file : undefined
  const line = entry?.line
  const locationText = file ? `${file}${line ? `, ${line}` : ''}` : null
  const headerTitle = entry?.type ? `${entry.type} ${title}` : title

  return (
    <section
      className="log-entry"
      data-ruleid={entry?.ruleId}
      data-log-entry-id={entry?.key}
      data-testid="log-entry"
      data-level={level}
      aria-label={t('log_entry_description', { level })}
    >
      <header className="log-entry-header-card">
        <button
          type="button"
          data-collapsed={collapsed}
          className="log-entry-header-button"
          onClick={() => setCollapsed(value => !value)}
          aria-label={collapsed ? t('expand') : t('collapse')}
        >
          <MaterialIcon
            className="log-entry-expand-icon"
            type={collapsed ? 'chevron_right' : 'expand_more'}
          />
          <div className="log-entry-header-content">
            <h3
              className={classNames('log-entry-header-text', {
                'log-entry-header-text-error': level === 'error',
                'log-entry-header-text-warning': level === 'warning',
                'log-entry-header-text-info':
                  level === 'info' || level === 'typesetting',
                'log-entry-header-text-raw': level === 'raw',
              })}
            >
              {headerTitle}
            </h3>
            {locationText && (
              <span className="log-entry-location">{`\u202A${locationText}\u202C`}</span>
            )}
          </div>
        </button>
        {file && (
          <div className="log-entry-header-actions">
            <OLIconButton
              onClick={() =>
                goToLogEntry(file, Number(line) || 1, entry?.column)
              }
              variant="ghost"
              icon="my_location"
              accessibilityLabel={t('go_to_code_location')}
              data-testid="log-entry-go-to-code"
            />
          </div>
        )}
      </header>
      {!collapsed && (
        <>
          <div className="horizontal-divider" />
          <div className="log-entry-content">
            {hint && (
              <div className="log-entry-formatted-content">
                {hint.formattedContent(entry?.contentDetails)}
              </div>
            )}
            {hint?.extraInfoURL && (
              <div className="log-entry-content-link">
                <a href={hint.extraInfoURL} target="_blank" rel="noopener">
                  {t('log_hint_extra_info')}
                </a>
              </div>
            )}
            {rawContent && (
              <div className="log-entry-content-raw-container">
                <pre className="log-entry-content-raw">{rawContent.trim()}</pre>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** Compile logs over the PDF: entries by severity, raw log and output files. */
export function PdfLogsPane() {
  const { t } = useTranslation()
  const logEntries = useCompileStore(s => s.logEntries)
  const rawLog = useCompileStore(s => s.rawLog)
  const result = useCompileStore(s => s.result)
  const status = useCompileStore(s => s.status)
  const clearCache = useCompileStore(s => s.clearCache)
  const [activeTab, setActiveTab] = useState<TabKey>('all')

  const tabs: { key: TabKey; label: string; entries: LogEntry[] }[] = [
    { key: 'all', label: t('all_logs'), entries: logEntries.all },
    { key: 'errors', label: t('errors'), entries: logEntries.errors },
    { key: 'warnings', label: t('warnings'), entries: logEntries.warnings },
    {
      key: 'typesetting',
      label: t('typesetting'),
      entries: logEntries.typesetting,
    },
  ]
  const entries = tabs.find(tab => tab.key === activeTab)?.entries ?? []
  const outputFiles = (result?.outputFiles ?? []).filter(
    file => file.path !== 'output.pdf'
  )

  return (
    <div className="new-logs-pane" data-testid="logs-pane">
      <div className="error-logs-tabs" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            className="error-logs-tab-header btn btn-link text-decoration-none"
            aria-selected={tab.key === activeTab}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <div className="error-logs-tab-count">
              {tab.entries.length > 99 ? '99+' : tab.entries.length}
            </div>
          </button>
        ))}
      </div>
      <div className="error-logs new-error-logs">
        <div className="logs-pane-content">
          {entries.length > LOG_PREVIEW_LIMIT && (
            <p className="text-muted small mb-0">
              {t('log_entries_truncated', {
                shown: LOG_PREVIEW_LIMIT,
                total: entries.length,
              })}
            </p>
          )}
          {entries.length === 0 && status !== 'compiling' && (
            <p className="text-muted small mb-0 p-2">{t('no_log_entries')}</p>
          )}
          {entries.slice(0, LOG_PREVIEW_LIMIT).map((entry, index) => (
            <LogEntryCard
              key={entry.key}
              entry={entry}
              level={entry.level}
              title={entry.message}
              rawContent={entry.content}
              autoExpand={index === 0}
            />
          ))}
          {rawLog && activeTab === 'all' && (
            <LogEntryCard
              level="raw"
              title={t('raw_logs')}
              rawContent={rawLog}
              showLocation={false}
            />
          )}
          {activeTab === 'all' && outputFiles.length > 0 && (
            <div className="log-entry" data-testid="output-files">
              <h3 className="log-entry-header-text log-entry-header-text-raw mb-2">
                {t('other_logs_and_files')}
              </h3>
              <ul className="list-unstyled mb-0">
                {outputFiles.map(file => (
                  <li key={file.path}>
                    <a
                      href={file.url}
                      download={file.path.split('/').pop()}
                      target="_blank"
                      rel="noopener"
                    >
                      {file.path}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="logs-pane-actions">
            <OLButton
              variant="secondary"
              size="sm"
              onClick={() => void clearCache()}
              disabled={status === 'compiling'}
              leadingIcon="delete"
            >
              {t('clear_cached_files')}
            </OLButton>
          </div>
        </div>
      </div>
    </div>
  )
}
