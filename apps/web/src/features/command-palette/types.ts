// Adapted from Overleaf services/web/frontend/js/features/command-palette/types.ts (AGPL-3.0).

export type CommandPaletteSearchResult = {
  /** Unique within one result list. */
  key: string
  title: string
  description?: string
  /** Formatted keyboard shortcut, shown at the right. */
  shortcut?: string
  /** Shown greyed out and not runnable. */
  disabled?: boolean
  onSelect(): void | Promise<void>
  score: number
}

export type CommandPaletteSource = {
  id: string
  search(query: string): CommandPaletteSearchResult[]
  defaults?(): CommandPaletteSearchResult[]
  /** Queries starting with this go to this source only (without it). */
  prefix?: string
  /** The source only answers queries that start with `prefix`. */
  prefixRequired?: boolean
}
