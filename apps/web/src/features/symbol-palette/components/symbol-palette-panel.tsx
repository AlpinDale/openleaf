import type { ProjectDetails } from '@openleaf/shared'
import classNames from 'classnames'
import { useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { RailPanelHeader } from '@/features/editor/components/rail'
import { useProjectSession } from '@/features/project/session-context'
import { useTranslation } from '@/i18n'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import {
  type PaletteSymbol,
  SYMBOL_CATEGORIES,
  SYMBOLS,
  type SymbolCategory,
  searchSymbols,
  usedPackages,
} from '../symbols'

/** Packages that provide the amssymb symbols (amssymb loads amsfonts). */
const AMS_SYMBOL_PACKAGES = ['amssymb', 'amsfonts']

/** Whether the main document loads amssymb/amsfonts; re-checked as it's edited. */
function useRootDocHasAmssymb(rootDocId: string | null): boolean {
  const { texts } = useProjectSession()
  const [loaded, setLoaded] = useState(true)

  useEffect(() => {
    const ytext: Y.Text | undefined = rootDocId
      ? texts.get(rootDocId)
      : undefined
    if (!ytext) {
      setLoaded(false)
      return
    }
    let timer: number | undefined
    const check = () => {
      const packages = usedPackages(ytext.toString())
      setLoaded(AMS_SYMBOL_PACKAGES.some(name => packages.has(name)))
    }
    const scheduleCheck = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(check, 500)
    }
    check()
    ytext.observe(scheduleCheck)
    return () => {
      window.clearTimeout(timer)
      ytext.unobserve(scheduleCheck)
    }
  }, [texts, rootDocId])

  return loaded
}

function insertSymbol(symbol: PaletteSymbol) {
  window.dispatchEvent(
    new CustomEvent('editor:insert-symbol', {
      detail: { command: symbol.command },
    })
  )
}

function SymbolItem({
  symbol,
  missingPackage,
}: {
  symbol: PaletteSymbol
  missingPackage: string | null
}) {
  const { t } = useTranslation()
  return (
    <OLTooltip
      id={`symbol-${symbol.command.slice(1)}`}
      description={
        <div>
          <div className="symbol-palette-item-command">{symbol.command}</div>
          <div>{symbol.name}</div>
          {missingPackage && (
            <div className="symbol-palette-item-notes">
              {t('requires_package_x', { package: missingPackage })}
            </div>
          )}
        </div>
      }
      overlayProps={{ placement: 'top', delay: { show: 300, hide: 0 } }}
    >
      <button
        type="button"
        className="symbol-palette-item"
        aria-label={symbol.command}
        onClick={() => insertSymbol(symbol)}
        data-testid="symbol-palette-item"
        data-command={symbol.command}
      >
        {symbol.character}
      </button>
    </OLTooltip>
  )
}

export function SymbolPalettePanel({ project }: { project: ProjectDetails }) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<SymbolCategory>('Greek')
  const [query, setQuery] = useState('')
  const hasAmssymb = useRootDocHasAmssymb(project.rootDocId)

  const searching = query.trim().length > 0
  const symbols = useMemo(
    () =>
      searching
        ? searchSymbols(query)
        : SYMBOLS.filter(symbol => symbol.category === category),
    [searching, query, category]
  )

  return (
    <div className="openleaf-rail-panel" data-testid="rail-panel-symbols">
      <RailPanelHeader title={t('symbol_palette')} />
      <div className="openleaf-rail-panel-body">
        <div className="symbol-palette openleaf-symbol-palette">
          <div className="symbol-palette-header-outer">
            <div className="symbol-palette-header">
              <div
                className="symbol-palette-tab-list"
                role="tablist"
                aria-label={t('categories')}
              >
                {SYMBOL_CATEGORIES.map(name => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    className="symbol-palette-tab"
                    aria-selected={!searching && category === name}
                    disabled={searching}
                    onClick={() => setCategory(name)}
                    data-testid={`symbol-category-${name}`}
                  >
                    {t(`symbol_category_${name.toLowerCase()}`)}
                  </button>
                ))}
              </div>
              <OLFormControl
                type="search"
                size="sm"
                className="symbol-palette-search"
                placeholder={`${t('search')}…`}
                aria-label={t('search')}
                value={query}
                onChange={event => setQuery(event.target.value)}
                data-testid="symbol-palette-search"
              />
            </div>
          </div>
          <div
            className={classNames('symbol-palette-body', {
              'symbol-palette-body-searching': searching,
            })}
            role="tabpanel"
          >
            {symbols.length === 0 ? (
              <div className="symbol-palette-empty">
                {t('no_symbols_found')}
              </div>
            ) : (
              <div className="symbol-palette-items">
                {symbols.map(symbol => (
                  <SymbolItem
                    key={symbol.command}
                    symbol={symbol}
                    missingPackage={
                      symbol.package && !hasAmssymb ? symbol.package : null
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
