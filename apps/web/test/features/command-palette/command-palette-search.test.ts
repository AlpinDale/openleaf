// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  commandSource,
  getSourcesMatchingQuery,
  paletteCommands,
  searchSources,
} from '@/features/command-palette/command-palette-search'
import type { CommandPaletteSource } from '@/features/command-palette/types'
import type { Command } from '@/features/ide-react/context/command-registry-context'

function registryOf(commands: Command[]) {
  return new Map(commands.map(command => [command.id, command]))
}

const handlers = {
  wordCount: vi.fn(),
  bold: vi.fn(),
  split: vi.fn(),
  stop: vi.fn(),
}

const registry = registryOf([
  { id: 'word_count', label: 'Word count', handler: handlers.wordCount },
  { id: 'format-bold', label: 'Bold', handler: handlers.bold },
  {
    id: 'change-layout-side-by-side',
    label: 'Split view',
    handler: handlers.split,
  },
  {
    id: 'stop-compile',
    label: 'Stop compilation',
    disabled: true,
    handler: handlers.stop,
  },
  { id: 'no-handler', label: 'Link only', href: '/somewhere' },
  { id: 'command-palette', label: 'Command palette', handler: vi.fn() },
])

const groups: Record<string, string> = {
  'format-bold': 'Format',
  'change-layout-side-by-side': 'View',
}

const commands = paletteCommands(
  registry,
  { 'format-bold': [{ key: 'Mod-b' }] },
  id => groups[id]
)

describe('paletteCommands', () => {
  it('offers runnable commands with group labels, except the palette itself', () => {
    expect(commands.map(command => command.label)).toEqual([
      'Word count',
      'Format: Bold',
      'View: Split view',
      'Stop compilation',
    ])
  })

  it('keeps disabled commands, marked as such', () => {
    const stop = commands.find(command => command.id === 'stop-compile')
    expect(stop?.disabled).toBe(true)
    expect(commands.find(c => c.id === 'word_count')?.disabled).toBe(false)
  })

  it('formats shortcut hints', () => {
    const bold = commands.find(command => command.id === 'format-bold')
    expect(bold?.shortcut).toMatch(/B$/)
    expect(commands.find(c => c.id === 'word_count')?.shortcut).toBeUndefined()
  })
})

describe('commandSource', () => {
  const source = commandSource(commands)

  it('matches by prefix', () => {
    const titles = source.search('word').map(result => result.title)
    expect(titles).toEqual(['Word count'])
  })

  it('matches fuzzily on longer terms', () => {
    expect(source.search('counr').map(r => r.title)).toEqual(['Word count'])
  })

  it('requires every term to match', () => {
    expect(source.search('word bold')).toEqual([])
    expect(source.search('view split').map(r => r.title)).toEqual([
      'View: Split view',
    ])
  })

  it('ranks disabled commands below runnable ones', () => {
    const results = searchSources('s', [source])
    const titles = results.map(result => result.title)
    expect(titles.at(-1)).toBe('Stop compilation')
    expect(results.at(-1)?.disabled).toBe(true)
  })

  it('runs the command handler on select', () => {
    source.search('word')[0]?.onSelect()
    expect(handlers.wordCount).toHaveBeenCalledWith({
      location: 'command-palette',
    })
  })

  it('lists every command for an empty query', () => {
    expect(source.defaults?.()).toHaveLength(commands.length)
  })
})

describe('getSourcesMatchingQuery', () => {
  const plain: CommandPaletteSource = { id: 'files', search: () => [] }
  const prefixed: CommandPaletteSource = {
    id: 'commands',
    prefix: '>',
    search: () => [],
  }
  const prefixOnly: CommandPaletteSource = {
    id: 'jump',
    prefix: ':',
    prefixRequired: true,
    search: () => [],
  }
  const sources = [plain, prefixed, prefixOnly]
  const ids = (query: string) =>
    getSourcesMatchingQuery(query, sources).map(
      ({ source, query }) => `${source.id}:${query}`
    )

  it('asks every source for its defaults on an empty query', () => {
    expect(ids('')).toEqual(['files:', 'commands:', 'jump:'])
  })

  it('routes a prefixed query to that source only, without the prefix', () => {
    expect(ids('> bold ')).toEqual(['commands:bold'])
    expect(ids(':12')).toEqual(['jump:12'])
  })

  it('skips prefix-only sources for plain queries', () => {
    expect(ids(' main ')).toEqual(['files:main', 'commands:main'])
  })
})

describe('searchSources', () => {
  it('merges results from all sources, best first', () => {
    const source = (id: string, scores: number[]): CommandPaletteSource => ({
      id,
      search: () =>
        scores.map(score => ({
          key: `${id}${score}`,
          title: `${id}${score}`,
          score,
          onSelect: () => {},
        })),
    })
    const results = searchSources('x', [source('a', [1, 5]), source('b', [3])])
    expect(results.map(result => result.title)).toEqual(['a5', 'b3', 'a1'])
  })
})
