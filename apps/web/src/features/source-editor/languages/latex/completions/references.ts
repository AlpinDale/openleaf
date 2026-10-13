/**
 * `cite` completions based on reference keys in the project
 */
import { Completion, CompletionContext } from '@codemirror/autocomplete'
import { Completions } from './types'
import { metadataState } from '../../../extensions/language'
import {
  type ReferencesSearchMode,
  referencesSearchModeFacet,
} from '../../../extensions/auto-complete'
import { extendRequiredParameter } from './apply'
import { maybeGetSectionForOption } from './sections'

export type ReferenceEntry = {
  key: string
  title: string
  author: string
  year: string
}

export function buildReferenceCompletions(
  completions: Completions,
  context: CompletionContext
) {
  const metadata = context.state.field(metadataState, false)

  if (!metadata) {
    return
  }

  for (const referenceKey of metadata.referenceKeys) {
    completions.references.push({
      type: 'reference',
      label: referenceKey,
      extend: extendRequiredParameter,
      section: maybeGetSectionForOption(context, 'references'),
      deduplicate: {
        key: referenceKey,
        priority: 1,
      },
    })
  }
}

/** Whether every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string) {
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index++
    if (index === needle.length) return true
  }
  return needle.length === 0
}

/**
 * Score of one entry for a query, or null when it doesn't match. Simple mode
 * matches key prefixes only; advanced mode matches every whitespace-separated
 * term against the key, author, or title, falling back to a fuzzy
 * (subsequence) match on the key.
 */
function scoreReference(
  entry: ReferenceEntry,
  query: string,
  mode: ReferencesSearchMode
): number | null {
  const key = entry.key.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (mode === 'simple') return key.startsWith(needle) ? 1 : null

  // BibTeX markup such as `The {\TeX}book` is matched as plain text
  const plain = (value: string) => value.replace(/[{}\\]/g, '').toLowerCase()
  const author = plain(entry.author)
  const title = plain(entry.title)
  let score = 0
  for (const term of needle.split(/\s+/).filter(Boolean)) {
    if (key.startsWith(term)) score += 8
    else if (key.includes(term)) score += 5
    else if (author.includes(term)) score += 3
    else if (title.includes(term)) score += 2
    else if (isSubsequence(term, key)) score += 1
    else return null
  }
  return score
}

/** Entries matching `query`, best first (ties by key). */
export function searchReferenceEntries(
  entries: readonly ReferenceEntry[],
  query: string,
  mode: ReferencesSearchMode
): ReferenceEntry[] {
  const scored: { entry: ReferenceEntry; score: number }[] = []
  for (const entry of entries) {
    const score = scoreReference(entry, query, mode)
    if (score !== null) scored.push({ entry, score })
  }
  scored.sort(
    (a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key)
  )
  return scored.map(item => item.entry)
}

/**
 * Completions for a cite key argument, searched by the user's reference
 * search mode. Results are pre-filtered and ordered, so CodeMirror must not
 * re-filter them (`filter: false`).
 */
export async function buildCiteKeyCompletions(
  context: CompletionContext,
  from: number,
  existingKeys: readonly string[]
): Promise<Completion[]> {
  const metadata = context.state.field(metadataState, false)
  if (!metadata) return []
  const mode = context.state.facet(referencesSearchModeFacet)
  const { hits } = await metadata.searchLocalReferences('')
  const entries: ReferenceEntry[] = hits
    .map(({ _source: { EntryKey, Fields } }) => ({
      key: EntryKey,
      title: Fields.title ?? '',
      author: Fields.author ?? '',
      year: Fields.year ?? '',
    }))
    .filter(entry => !existingKeys.includes(entry.key))
  const query = context.state.sliceDoc(from, context.pos)
  const section = maybeGetSectionForOption(context, 'references')
  return searchReferenceEntries(entries, query, mode).map(entry => ({
    type: 'reference',
    label: entry.key,
    info:
      mode === 'advanced' && (entry.author || entry.title)
        ? [entry.author, entry.year && `(${entry.year})`, entry.title]
            .filter(Boolean)
            .join(' ')
        : undefined,
    extend: extendRequiredParameter,
    section,
    deduplicate: { key: entry.key, priority: 1 },
  }))
}
