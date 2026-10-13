// Adapted from Overleaf services/web/frontend/js/features/command-palette/components/
// {command-palette-root,command-palette-body}.tsx (AGPL-3.0).
import type { ProjectTree } from '@openleaf/shared'
import classNames from 'classnames'
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import { useTranslation } from '@/i18n'
import { OLModal, OLModalBody } from '@/shared/components/ol/ol-modal'
import useDebounce from '@/shared/hooks/use-debounce'
import useEventListener from '@/shared/hooks/use-event-listener'
import { debugConsole } from '@/utils/debugging'
import { searchSources } from '../command-palette-search'
import {
  setCommandPaletteOpen,
  useCommandPaletteStore,
} from '../command-palette-store'
import { useCommandPaletteSources } from '../hooks/use-command-palette-sources'
import type { CommandPaletteSearchResult } from '../types'

function CommandPaletteBody({
  tree,
  onHide,
}: {
  tree: ProjectTree
  onHide: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 25)
  const sources = useCommandPaletteSources(tree)
  const results = useMemo(
    () => searchSources(debouncedQuery, sources),
    [debouncedQuery, sources]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new result list resets the selection
  useEffect(() => setSelectedIndex(0), [results])

  useEffect(() => {
    const element = resultsRef.current?.children[selectedIndex]
    element?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const runResult = (result: CommandPaletteSearchResult) => {
    if (result.disabled) return
    onHide()
    try {
      const pending = result.onSelect()
      if (pending instanceof Promise) {
        pending.catch(err => debugConsole.error('Command palette error', err))
      }
    } catch (err) {
      debugConsole.error('Command palette error', err)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setSelectedIndex(i => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setSelectedIndex(i => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // typed faster than the debounce: run the best match for what's typed
      const selected =
        query === debouncedQuery
          ? results[selectedIndex]
          : searchSources(query, sources)[0]
      if (selected) runResult(selected)
    }
  }

  useEventListener(
    'mousedown',
    useCallback(
      (event: MouseEvent) => {
        const target = event.target as Element | null
        if (!target?.closest('.command-palette .modal-dialog')) onHide()
      },
      [onHide]
    )
  )

  return (
    <OLModal
      show
      onHide={onHide}
      className="command-palette"
      animation={false}
      backdrop={false}
      themed
      data-testid="command-palette"
    >
      <OLModalBody>
        <div className="command-palette-input">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('type_a_command')}
            aria-label={t('command_palette_search')}
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
            autoFocus
          />
        </div>
        <div
          ref={resultsRef}
          className="command-palette-results"
          role="menu"
          aria-label={t('command_palette')}
        >
          {results.length === 0 && (
            <div role="none" className="command-palette-result">
              <div className="command-palette-result-title command-palette-no-matches">
                {t('no_matches')}
              </div>
            </div>
          )}
          {results.map((result, index) => (
            <div
              role="none"
              key={result.key}
              className={classNames('command-palette-result', {
                'command-palette-result-selected': index === selectedIndex,
                'command-palette-result-disabled': result.disabled,
              })}
            >
              <button
                type="button"
                role="menuitem"
                aria-disabled={result.disabled}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => runResult(result)}
              >
                <div className="command-palette-result-title">
                  {result.title}
                  {result.description && (
                    <span className="command-palette-result-description">
                      {result.description}
                    </span>
                  )}
                </div>
                {result.shortcut && (
                  <span className="command-palette-result-shortcut">
                    {result.shortcut}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      </OLModalBody>
    </OLModal>
  )
}

/**
 * Searchable list of the editor's commands and files, opened with ⌘P /
 * Ctrl+P (the shell's global shortcuts) or from the View menu. Hidden while
 * the history view is open, as in Overleaf.
 */
export function CommandPalette({
  tree,
  disabled,
}: {
  tree: ProjectTree
  disabled: boolean
}) {
  const { t } = useTranslation()
  const open = useCommandPaletteStore(s => s.open)
  const onHide = useCallback(() => setCommandPaletteOpen(false), [])

  useEffect(() => {
    if (disabled) setCommandPaletteOpen(false)
  }, [disabled])

  useCommandProvider(() => {
    if (disabled) return
    return [
      {
        id: 'command-palette',
        label: t('command_palette'),
        handler: () => setCommandPaletteOpen(true),
      },
    ]
  }, [disabled, t])

  if (!open || disabled) return null
  return <CommandPaletteBody tree={tree} onHide={onHide} />
}
