// Adapted from Overleaf services/web/modules/full-project-search/frontend/js/util/search-snapshot.ts (AGPL-3.0).
// OpenLeaf searches the live Yjs texts instead of a fetched project snapshot.
import {
  RegExpCursor,
  SearchCursor,
  type SearchQuery,
} from '@codemirror/search'
import { Text } from '@codemirror/state'
import { categorizer, regexpWordTest, stringWordTest } from './search'

/** Stop collecting after this many matches across the project. */
export const MAX_SEARCH_HITS = 2000

export type Hit = {
  /** 0-based line index. */
  lineIndex: number
  /** 0-based column of the match in its line. */
  matchIndex: number
  length: number
  /** Absolute offsets of the match in the doc. */
  from: number
  to: number
}

export type MatchedFile = {
  docId: string
  path: string
  lines: string[]
  hits: Hit[]
}

export type SearchableDoc = { id: string; path: string; content: string }

export type ProjectSearchResult = {
  files: MatchedFile[]
  /** True when the search stopped at `MAX_SEARCH_HITS`. */
  truncated: boolean
}

const toLowerCase = (string: string) => string.toLowerCase()

function createCursor(text: Text, query: SearchQuery) {
  if (query.regexp) {
    return new RegExpCursor(text, query.search, {
      ignoreCase: !query.caseSensitive,
      test: query.wholeWord ? regexpWordTest(categorizer) : undefined,
    })
  }
  return new SearchCursor(
    text,
    query.search,
    undefined,
    undefined,
    query.caseSensitive ? undefined : toLowerCase,
    query.wholeWord ? stringWordTest(text, categorizer) : undefined
  )
}

/** Finds every match of `query` in `docs`; results are sorted by path. */
export function searchProject(
  docs: SearchableDoc[],
  query: SearchQuery
): ProjectSearchResult {
  const files: MatchedFile[] = []
  let total = 0
  let truncated = false

  const sorted = [...docs].sort((a, b) => a.path.localeCompare(b.path))
  for (const doc of sorted) {
    if (truncated) break
    const lines = doc.content.split('\n')
    const text = Text.of(lines)
    const cursor = createCursor(text, query)
    const hits: Hit[] = []
    while (!cursor.next().done) {
      if (total >= MAX_SEARCH_HITS) {
        truncated = true
        break
      }
      const { from, to } = cursor.value
      // An empty regexp match would loop forever on the same position.
      if (from === to) continue
      const line = text.lineAt(from)
      hits.push({
        lineIndex: line.number - 1,
        matchIndex: from - line.from,
        length: Math.min(to, line.to) - from,
        from,
        to,
      })
      total++
    }
    if (hits.length > 0) {
      files.push({ docId: doc.id, path: doc.path, lines, hits })
    }
  }

  return { files, truncated }
}
