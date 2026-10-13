// Matching and filtering for the command palette, adapted from Overleaf
// services/web/frontend/js/features/command-palette/hooks/{use-command-palette-results,use-command-registry-source}.ts (AGPL-3.0).
import MiniSearch from 'minisearch'
import {
  type Command,
  formatShortcut,
  type Shortcuts,
} from '@/features/ide-react/context/command-registry-context'
import type { CommandPaletteSearchResult, CommandPaletteSource } from './types'

/** Prefix and fuzziness used for every palette index, as in Overleaf. */
export const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: (term: string) => (term.length > 3 ? 0.2 : false),
  combineWith: 'AND',
} as const

/**
 * The sources that answer `query`, each with the query it should search:
 * an empty query asks every source for its defaults; a query starting with a
 * source's prefix goes to the sources with that prefix (prefix stripped);
 * anything else goes to the sources that don't require a prefix.
 */
export function getSourcesMatchingQuery(
  query: string,
  sources: CommandPaletteSource[]
): { query: string; source: CommandPaletteSource }[] {
  if (!query) return sources.map(source => ({ source, query }))
  const prefixed = sources.filter(
    source => source.prefix && query.startsWith(source.prefix)
  )
  if (prefixed.length > 0) {
    return prefixed.map(source => ({
      source,
      query: query.slice(source.prefix?.length ?? 0).trim(),
    }))
  }
  return sources
    .filter(source => !source.prefixRequired)
    .map(source => ({ source, query: query.trim() }))
}

/** Results of all `sources` for `query`, best first. */
export function searchSources(
  query: string,
  sources: CommandPaletteSource[]
): CommandPaletteSearchResult[] {
  return getSourcesMatchingQuery(query, sources)
    .flatMap(({ source, query }) =>
      query ? source.search(query) : (source.defaults?.() ?? [])
    )
    .sort((a, b) => b.score - a.score)
}

export type PaletteCommand = {
  id: string
  /** Label including its menu group, e.g. "View: Split view". */
  label: string
  shortcut?: string
  disabled: boolean
  run(): void
}

/**
 * Registry commands the palette offers, in registry order: every command with
 * a handler except the palette itself. Labels get their menu group prefix.
 */
export function paletteCommands(
  registry: Map<string, Command>,
  shortcuts: Shortcuts,
  groupOf: (id: string) => string | undefined
): PaletteCommand[] {
  const commands: PaletteCommand[] = []
  for (const command of registry.values()) {
    const { handler } = command
    if (!handler || command.id === 'command-palette') continue
    const group = groupOf(command.id)
    const shortcut = shortcuts[command.id]?.[0]
    commands.push({
      id: command.id,
      label: group ? `${group}: ${command.label}` : command.label,
      shortcut: shortcut ? formatShortcut(shortcut) : undefined,
      disabled: Boolean(command.disabled),
      run: () => handler({ location: 'command-palette' }),
    })
  }
  return commands
}

function toResult(
  command: PaletteCommand,
  score: number
): CommandPaletteSearchResult {
  return {
    key: `command:${command.id}`,
    title: command.label,
    shortcut: command.shortcut,
    disabled: command.disabled,
    onSelect: command.run,
    score,
  }
}

/** A palette source over `commands` (fuzzy prefix match on the label). */
export function commandSource(
  commands: PaletteCommand[]
): CommandPaletteSource {
  const index = new MiniSearch<PaletteCommand>({
    fields: ['label'],
    storeFields: ['id'],
  })
  index.addAll(commands)
  const byId = new Map(commands.map(command => [command.id, command]))
  return {
    id: 'command-registry',
    prefix: '>',
    search: query =>
      index.search(query, SEARCH_OPTIONS).flatMap(({ id, score }) => {
        const command = byId.get(id)
        // disabled commands stay visible, below the runnable ones
        return command
          ? [toResult(command, command.disabled ? score / 1000 : score)]
          : []
      }),
    defaults: () => commands.map(command => toResult(command, 1)),
  }
}
