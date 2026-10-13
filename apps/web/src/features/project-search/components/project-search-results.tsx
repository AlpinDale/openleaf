// Adapted from Overleaf services/web/modules/full-project-search/frontend/js/components/{full-project-search-results,matched-hit,matched-hit-highlight}.tsx (AGPL-3.0).
import classNames from 'classnames'
import {
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { goToPosition } from '@/features/editor/editor-bridge'
import MaterialIcon from '@/shared/components/material-icon'
import { getMatchedHitSnippet } from '../util/matched-hit-snippet'
import type { Hit, MatchedFile } from '../util/search-project'

function MatchedHit({
  file,
  hit,
  selected,
  tabbable,
  onSelect,
}: {
  file: MatchedFile
  hit: Hit
  selected: boolean
  tabbable: boolean
  onSelect: (hit: Hit) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (selected) ref.current?.focus()
  }, [selected])

  const parts = useMemo(
    () =>
      getMatchedHitSnippet(
        file.lines[hit.lineIndex],
        hit.matchIndex,
        hit.length
      ),
    [file, hit]
  )

  return (
    <button
      type="button"
      ref={ref}
      className={classNames('list-group-item matched-file-hit', {
        'matched-file-hit-selected': selected,
      })}
      tabIndex={tabbable ? 0 : -1}
      aria-current={selected}
      onMouseDown={event => {
        event.preventDefault()
        onSelect(hit)
      }}
      data-testid="project-search-hit"
    >
      <span className="matched-line-number">{hit.lineIndex + 1}</span>
      <span className="matched-hit-snippet">
        {parts.before}
        <b className="matched-hit-highlight">{parts.match}</b>
        {parts.after}
      </span>
    </button>
  )
}

export function ProjectSearchResults({
  files,
  currentDocId,
}: {
  files: MatchedFile[]
  currentDocId: string | null
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedHit, setSelectedHit] = useState<Hit>()

  const hits = useMemo(() => files.flatMap(file => file.hits), [files])
  const fileOfHit = useMemo(
    () =>
      new Map(
        files.flatMap(file => file.hits.map(hit => [hit, file] as const))
      ),
    [files]
  )

  /** Opens the hit's doc with the match selected; keyboard navigation keeps focus in the list. */
  const select = useCallback(
    (hit: Hit, keepFocus: boolean) => {
      setSelectedHit(hit)
      const file = fileOfHit.get(hit)
      if (!file) return
      goToPosition({
        docId: file.docId,
        line: hit.lineIndex + 1,
        selection: { from: hit.from, to: hit.to },
      }).then(() => {
        if (keepFocus) {
          document
            .querySelector<HTMLElement>('.matched-file-hit-selected')
            ?.focus()
        }
      })
    },
    [fileOfHit]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = selectedHit ? hits.indexOf(selectedHit) : -1
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % hits.length
        : (index <= 0 ? hits.length : index) - 1
    const hit = hits[next]
    if (hit) select(hit, true)
  }

  const toggleCollapsed = (path: string) =>
    setCollapsed(value => {
      const next = new Set(value)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const tabbableHit = selectedHit ?? hits[0]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow-key navigation between the hit buttons
    <div className="matched-files" onKeyDown={handleKeyDown}>
      {files.map(file => (
        <div
          key={file.docId}
          className={classNames('matched-file', {
            'matched-file-open': file.docId === currentDocId,
          })}
          data-testid="project-search-file"
        >
          <button
            type="button"
            className="collapsible-file-header"
            onClick={() => toggleCollapsed(file.path)}
            translate="no"
          >
            <MaterialIcon
              type={
                collapsed.has(file.path)
                  ? 'keyboard_arrow_right'
                  : 'keyboard_arrow_down'
              }
            />
            {file.path}
            <div className="collapsible-file-header-count">
              {file.hits.length}
            </div>
          </button>
          {!collapsed.has(file.path) && (
            <div className="list-group matched-file-hits">
              {file.hits.map(hit => (
                <MatchedHit
                  key={hit.from}
                  file={file}
                  hit={hit}
                  selected={hit === selectedHit}
                  tabbable={hit === tabbableHit}
                  onSelect={hit => select(hit, false)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
