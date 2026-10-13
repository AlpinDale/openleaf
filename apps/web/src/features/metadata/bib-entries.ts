export type BibEntry = {
  key: string
  title: string
  author: string
  year: string
}

const ENTRY_RE = /@\s*([a-zA-Z]+)\s*[{(]\s*([^,\s]+)\s*,/g
const SKIPPED_TYPES = new Set(['string', 'preamble', 'comment'])

function field(body: string, name: string) {
  const match = body.match(
    new RegExp(
      `\\b${name}\\s*=\\s*(?:\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|(\\w+))`,
      'i'
    )
  )
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '')
    .replace(/[{}]/g, '')
    .trim()
}

/** The entries of a .bib file (`@string`, `@preamble` and `@comment` skipped). */
export function extractBibEntries(text: string): BibEntry[] {
  const entries: BibEntry[] = []
  const matches = [...text.matchAll(ENTRY_RE)]
  matches.forEach((match, i) => {
    if (SKIPPED_TYPES.has(match[1].toLowerCase())) return
    const body = text.slice(match.index, matches[i + 1]?.index ?? text.length)
    entries.push({
      key: match[2],
      title: field(body, 'title'),
      author: field(body, 'author'),
      year: field(body, 'year'),
    })
  })
  return entries
}
