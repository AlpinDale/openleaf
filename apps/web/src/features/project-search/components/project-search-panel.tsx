// Adapted from Overleaf services/web/modules/full-project-search/frontend/js/components/{full-project-search-ui,full-project-search-modifiers,full-project-match-counts}.tsx (AGPL-3.0).
import { SearchQuery } from '@codemirror/search'
import type { ProjectTree } from '@openleaf/shared'
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMe } from '@/api/auth'
import { RailPanelHeader } from '@/features/editor/components/rail'
import { useEditorStore } from '@/features/editor/editor-store'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useProjectSession } from '@/features/project/session-context'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import useEventListener from '@/shared/hooks/use-event-listener'
import { isMac } from '@/shared/utils/os'
import { userStyles } from '@/shared/utils/styles'
import {
  MAX_SEARCH_HITS,
  type ProjectSearchResult,
  searchProject,
} from '../util/search-project'
import { ProjectSearchResults } from './project-search-results'

type ModifierName = 'caseSensitive' | 'regexp' | 'wholeWord'

const MODIFIERS: { name: ModifierName; label: string; titleKey: string }[] = [
  { name: 'caseSensitive', label: 'Aa', titleKey: 'search_match_case' },
  { name: 'regexp', label: '[.*]', titleKey: 'search_regexp' },
  { name: 'wholeWord', label: 'W', titleKey: 'search_whole_word' },
]

export function ProjectSearchPanel({ tree }: { tree: ProjectTree }) {
  const { t } = useTranslation()
  const { texts } = useProjectSession()
  const openDocId = useEditorStore(s => s.openDocId)
  const setRailTab = useEditorStore(s => s.setRailTab)
  const settings = useMe().data?.settings
  const activeOverallTheme = useActiveOverallTheme()

  const [query, setQuery] = useState('')
  const [modifiers, setModifiers] = useState<Record<ModifierName, boolean>>({
    caseSensitive: false,
    regexp: false,
    wholeWord: false,
  })
  const [result, setResult] = useState<ProjectSearchResult>()
  // Remounts the results (dropping the selected hit) for every new search.
  const [searchCount, setSearchCount] = useState(0)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)

  const runSearch = (event: FormEvent) => {
    event.preventDefault()
    const searchQuery = new SearchQuery({
      search: query,
      ...modifiers,
      literal: !modifiers.regexp,
    })
    if (!query.trim()) {
      setResult(undefined)
      setError(undefined)
      return
    }
    if (!searchQuery.valid) {
      setResult(undefined)
      setError(t('invalid_regular_expression'))
      return
    }
    const index = indexTree(tree)
    const docs = tree.entries.flatMap(entry => {
      const ytext = entry.kind === 'doc' ? texts.get(entry.id) : undefined
      const path = index.paths.get(entry.id)
      return ytext && path
        ? [{ id: entry.id, path, content: ytext.toString() }]
        : []
    })
    setError(undefined)
    setResult(searchProject(docs, searchQuery))
    setSearchCount(count => count + 1)
  }

  // Focus the input when the panel opens, and again on Mod-Shift-F.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEventListener(
    'keydown',
    useCallback((event: globalThis.KeyboardEvent) => {
      if (
        (isMac ? event.metaKey : event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        inputRef.current?.focus()
      }
    }, [])
  )

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setRailTab(null)
  }

  const style = useMemo(() => {
    if (!settings) return undefined
    const { fontFamily, fontSize } = userStyles(settings)
    return {
      '--font-family': fontFamily,
      '--font-size': fontSize,
    } as CSSProperties
  }, [settings])

  const totalHits = result?.files.reduce(
    (sum, file) => sum + file.hits.length,
    0
  )

  return (
    <div className="openleaf-rail-panel" data-testid="rail-panel-search">
      <RailPanelHeader title={t('project_search')} />
      <div className="openleaf-rail-panel-body">
        <div
          className="full-project-search"
          style={style}
          data-bs-theme={activeOverallTheme}
        >
          <search
            className="full-project-search-form"
            aria-label={t('search_all_project_files')}
            onKeyDown={handleKeyDown}
          >
            <form onSubmit={runSearch}>
              <div className="d-flex gap-1">
                <OLFormControl
                  ref={inputRef}
                  type="search"
                  size="sm"
                  aria-label={t('search')}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={`${t('search_all_project_files')}…`}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  data-testid="project-search-input"
                />
                <OLButton type="submit" variant="primary" size="sm">
                  {t('search')}
                </OLButton>
              </div>
              <fieldset className="full-project-search-modifiers">
                {MODIFIERS.map(({ name, label, titleKey }) => (
                  <OLTooltip
                    key={name}
                    id={`project-search-${name}`}
                    description={t(titleKey)}
                    overlayProps={{ placement: 'bottom' }}
                  >
                    <span>
                      <OLFormCheckbox
                        inline
                        id={`project-search-${name}`}
                        label={label}
                        aria-label={t(titleKey)}
                        checked={modifiers[name]}
                        onChange={event =>
                          setModifiers(value => ({
                            ...value,
                            [name]: event.target.checked,
                          }))
                        }
                        data-testid={`project-search-${name}`}
                      />
                    </span>
                  </OLTooltip>
                ))}
              </fieldset>
            </form>
          </search>

          {error && <Notification type="error" content={error} />}

          {result && (
            <div className="match-counts" data-testid="project-search-count">
              {t('project_search_result_count', { count: totalHits ?? 0 })}
              {result.files.length > 0 &&
                ` ${t('project_search_file_count', { count: result.files.length })}`}
              {result.truncated &&
                ` ${t('project_search_truncated', { count: MAX_SEARCH_HITS })}`}
            </div>
          )}

          {result && result.files.length > 0 && (
            <ProjectSearchResults
              key={searchCount}
              files={result.files}
              currentDocId={openDocId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
