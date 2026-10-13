const EDITABLE_EXTENSIONS = new Set(
  'tex latex ltx sty cls clo cfg def fd dtx ins bib bst bbx cbx lbx dbx ldf txt md markdown csv tsv tikz pgf asy rnw rtex rmd r lua py sh json yaml yml xml'.split(
    ' '
  )
)
const EDITABLE_NAMES = new Set([
  'latexmkrc',
  '.latexmkrc',
  'Makefile',
  'README',
])

export const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024
export const MAX_ENTRY_NAME_BYTES = 255

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
const FORBIDDEN_NAME_CHARS = /[/\\*?<>|:"\u0000-\u001f\u007f]/

export function validateEntryName(name: string): string | null {
  if (name.length < 1 || name.length > 150)
    return 'Name must be 1–150 characters'
  if (!name.isWellFormed()) return 'Name contains invalid Unicode'
  let bytes = 0
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      index++
    } else {
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
    }
    if (bytes > MAX_ENTRY_NAME_BYTES)
      return `Name must be at most ${MAX_ENTRY_NAME_BYTES} UTF-8 bytes`
  }
  if (name !== name.trim()) return 'Name must not start or end with spaces'
  if (name === '.' || name === '..') return 'Invalid name'
  if (FORBIDDEN_NAME_CHARS.test(name)) return 'Name contains invalid characters'
  return null
}

export function isValidEntryName(name: string): boolean {
  return validateEntryName(name) === null
}

export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

export function isEditableFilename(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (EDITABLE_NAMES.has(base)) return true
  return EDITABLE_EXTENSIONS.has(fileExtension(base))
}

export function classifyContent(
  name: string,
  bytes: Uint8Array
): 'doc' | 'file' {
  if (!isEditableFilename(name) || bytes.byteLength > MAX_EDITABLE_FILE_BYTES)
    return 'file'
  if (bytes.includes(0)) return 'file'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'doc'
  } catch {
    return 'file'
  }
}

const DOCUMENTCLASS_RE = /^\s*\\documentclass/m

export function detectRootDocPath(
  paths: string[],
  readText: (path: string) => string | null | undefined
): string | null {
  if (paths.includes('main.tex') && readText('main.tex') != null)
    return 'main.tex'
  const candidates = paths.filter(p => fileExtension(p) === 'tex').sort()
  for (const path of candidates) {
    const text = readText(path)
    if (text != null && DOCUMENTCLASS_RE.test(text)) return path
  }
  return null
}
