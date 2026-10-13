import type { Command } from '@/features/ide-react/context/metadata-context'
import type { PackageCommand } from './package-mapping'

export type DocMeta = {
  labels: string[]
  packages: Record<string, Command[]>
  packageNames: string[]
  documentClass: string | null
}

const LABEL_RE = /\\label{(.{0,80}?)}/g
const LABEL_OPTION_RE = /\blabel={?(.{0,80}?)[\s},\]]/g
const PACKAGE_RE = /^\\usepackage(?:\[.{0,80}?])?{(.{0,80}?)}/g
const REQ_PACKAGE_RE = /^\\RequirePackage(?:\[.{0,80}?])?{(.{0,80}?)}/g
const DOCUMENT_CLASS_RE = /^\\documentclass(?:\[.{0,80}?])?{(.{0,80}?)}/

export function extractMetaFromDoc(
  lines: string[],
  packageMapping: Record<string, PackageCommand[]>
): DocMeta {
  const docMeta: DocMeta = {
    labels: [],
    packages: {},
    packageNames: [],
    documentClass: null,
  }

  for (const rawLine of lines) {
    const line = getNonCommentedContent(rawLine)

    for (const label of lineMatches(LABEL_RE, line)) {
      docMeta.labels.push(label)
    }

    for (const label of lineMatches(LABEL_OPTION_RE, line)) {
      docMeta.labels.push(label)
    }

    for (const pkg of lineMatches(PACKAGE_RE, line, ',')) {
      docMeta.packageNames.push(pkg)
    }

    for (const pkg of lineMatches(REQ_PACKAGE_RE, line, ',')) {
      docMeta.packageNames.push(pkg)
    }

    if (docMeta.documentClass == null) {
      const match = line.match(DOCUMENT_CLASS_RE)
      if (match != null) {
        docMeta.documentClass = match[1]
      }
    }
  }

  for (const packageName of docMeta.packageNames) {
    const commands = packageMapping[packageName]
    if (commands) {
      docMeta.packages[packageName] = commands.map(command => ({
        ...command,
        snippet: command.snippet ?? command.caption,
      }))
    }
  }

  return docMeta
}

function* lineMatches(
  matchRe: RegExp,
  line: string,
  separator?: string
): Generator<string> {
  for (const match of line.matchAll(matchRe)) {
    const matched = match[1].trim()

    if (matched) {
      if (separator) {
        const items = matched
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)

        for (const item of items) {
          yield item
        }
      } else {
        yield matched
      }
    }
  }
}

/** Trims comment content from a line */
function getNonCommentedContent(rawLine: string) {
  return rawLine.replace(/(^|[^\\])%.*/, '$1')
}
