// Adapted from Overleaf services/web/frontend/js/features/command-palette/hooks/
// {use-command-palette-sources,use-command-registry-source,use-file-tree-command-source,use-jump-to-line-command-source}.ts (AGPL-3.0).
import type { ProjectTree } from '@openleaf/shared'
import MiniSearch from 'minisearch'
import { useMemo } from 'react'
import { goToPosition } from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useCommandRegistry } from '@/features/ide-react/context/command-registry-context'
import { useTranslation } from '@/i18n'
import {
  commandSource,
  paletteCommands,
  SEARCH_OPTIONS,
} from '../command-palette-search'
import type { CommandPaletteSearchResult, CommandPaletteSource } from '../types'

/** Menu group shown before a command's label, by id prefix. */
const GROUP_PREFIXES: [prefix: string, labelKey: string][] = [
  ['insert-', 'insert'],
  ['format-', 'format'],
  ['change-layout-', 'view'],
  ['view-pdf-', 'view'],
]

const FILE_POSITION_REGEX = /:(\d+)(?:,(\d+))?$/
const JUMP_REGEX = /^(\d+)(?:,(\d+))?$/

type FlatFile = { id: string; path: string; name: string; kind: string }

function useRegistrySource(): CommandPaletteSource {
  const { t } = useTranslation()
  const { registry, shortcuts } = useCommandRegistry()
  return useMemo(() => {
    const groupOf = (id: string) => {
      const match = GROUP_PREFIXES.find(([prefix]) => id.startsWith(prefix))
      return match ? t(match[1]) : undefined
    }
    return commandSource(paletteCommands(registry, shortcuts, groupOf))
  }, [registry, shortcuts, t])
}

function openEntry(file: FlatFile, line?: number, column?: number) {
  if (file.kind === 'file') {
    useEditorStore.getState().openFile(file.id)
  } else if (line !== undefined) {
    void goToPosition({
      docId: file.id,
      line,
      column: column !== undefined ? column - 1 : undefined,
    })
  } else {
    useEditorStore.getState().openDoc(file.id)
  }
}

/** Project files by name or path; `name:line[,column]` jumps into a doc. */
function useFileSource(tree: ProjectTree): CommandPaletteSource {
  return useMemo(() => {
    const index = indexTree(tree)
    const files: FlatFile[] = [...index.paths.entries()]
      .map(([id, path]) => ({
        id,
        path,
        name: path.split('/').pop() ?? path,
        kind: index.byId.get(id)?.kind ?? 'folder',
      }))
      .filter(file => file.kind !== 'folder')
      .sort((a, b) => a.path.localeCompare(b.path))
    const byId = new Map(files.map(file => [file.id, file]))
    const search = new MiniSearch<FlatFile>({ fields: ['path', 'name'] })
    search.addAll(files)

    const toResult = (
      file: FlatFile,
      score: number,
      line?: number,
      column?: number
    ): CommandPaletteSearchResult => ({
      key: `file:${file.id}`,
      title: file.name,
      description:
        file.path === file.name
          ? undefined
          : file.path.split('/').slice(0, -1).join('/'),
      onSelect: () => openEntry(file, line, column),
      score,
    })

    return {
      id: 'file-tree',
      search(query) {
        const position = FILE_POSITION_REGEX.exec(query)
        const line = position ? Number(position[1]) : undefined
        const column = position?.[2] ? Number(position[2]) : undefined
        const text = position ? query.slice(0, position.index) : query
        return search.search(text, SEARCH_OPTIONS).flatMap(({ id, score }) => {
          const file = byId.get(id)
          return file ? [toResult(file, score, line, column)] : []
        })
      },
      defaults: () => files.slice(0, 10).map(file => toResult(file, 1)),
    }
  }, [tree])
}

/** `:line[,column]` in the open doc. */
function useJumpToLineSource(): CommandPaletteSource {
  const { t } = useTranslation()
  return useMemo(
    () => ({
      id: 'jump-to-line',
      prefix: ':',
      prefixRequired: true,
      search(query) {
        const match = JUMP_REGEX.exec(query)
        const docId = useEditorStore.getState().openDocId
        if (!match || !docId) return []
        const line = Number(match[1])
        const column = match[2] ? Number(match[2]) : undefined
        return [
          {
            key: 'jump-to-line',
            title:
              column !== undefined
                ? t('jump_to_line_x_column_y', { line, column })
                : t('jump_to_line_x', { line }),
            onSelect: () =>
              goToPosition({
                docId,
                line,
                column: column !== undefined ? column - 1 : undefined,
              }),
            score: 1,
          },
        ]
      },
    }),
    [t]
  )
}

export function useCommandPaletteSources(
  tree: ProjectTree
): CommandPaletteSource[] {
  const files = useFileSource(tree)
  const commands = useRegistrySource()
  const jump = useJumpToLineSource()
  return useMemo(() => [files, commands, jump], [files, commands, jump])
}
