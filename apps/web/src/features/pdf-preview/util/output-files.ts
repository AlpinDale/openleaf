import HumanReadableLogs from '../../../ide/human-readable-logs/HumanReadableLogs'
import BibLogParser, {
  BibLogEntry,
} from '../../../ide/log-parser/bib-log-parser'
import { debugConsole } from '@/utils/debugging'
import { LogEntry } from './types'
import type { ChktexEntry, CompileResponse } from '@openleaf/shared'
import { LatexLogEntry } from '@/ide/log-parser/latex-log-parser'

const MAX_LOG_SIZE = 1024 * 1024 // 1MB
const MAX_BIB_LOG_SIZE_PER_FILE = MAX_LOG_SIZE

let nextEntryId = 1

function generateEntryKey(): string {
  return 'compile-log-entry-' + nextEntryId++
}

export type LogEntries = {
  errors: LogEntry[]
  warnings: LogEntry[]
  typesetting: LogEntry[]
  all: LogEntry[]
}

export const emptyLogEntries = (): LogEntries => ({
  errors: [],
  warnings: [],
  typesetting: [],
  all: [],
})

type LogResult = {
  log: string | null
  logEntries: LogEntries
}

export async function handleLogFiles(
  data: CompileResponse,
  signal?: AbortSignal
): Promise<LogResult> {
  const result: LogResult = { log: null, logEntries: emptyLogEntries() }

  const normalize = (file: string) =>
    normalizeFilePath(file, data.logPathPrefix)

  function accumulateResults(
    newEntries: {
      errors?: (LatexLogEntry | BibLogEntry)[]
      warnings?: (LatexLogEntry | BibLogEntry)[]
      typesetting?: (LatexLogEntry | BibLogEntry)[]
    },
    type?: string
  ) {
    for (const key of ['errors', 'warnings', 'typesetting'] as const) {
      if (newEntries[key]) {
        for (const entry of newEntries[key]) {
          if (type) {
            // Type casting as we are mutating LatexLogEntry | BibLogEntry into a LogEntry
            ;(entry as LogEntry).type = type
          }
          if (entry.file) {
            entry.file = normalize(entry.file)
          }
          ;(entry as LogEntry).key = generateEntryKey()
        }
        result.logEntries[key].push(...(newEntries[key] as LogEntry[]))
      }
    }
  }

  const outputFiles = new Map(data.outputFiles.map(file => [file.path, file]))

  const logFile = outputFiles.get('output.log')

  if (logFile) {
    result.log = await fetchFileWithSizeLimit(logFile.url, signal, MAX_LOG_SIZE)
    try {
      const { errors, warnings, typesetting } = HumanReadableLogs.parse(
        result.log,
        {
          ignoreDuplicates: true,
        }
      )
      accumulateResults({ errors, warnings, typesetting })
    } catch (e) {
      debugConsole.warn(e) // ignore failure to parse the log file, but log a warning
    }
  }

  for (const [filename, file] of outputFiles) {
    if (!filename.endsWith('.blg')) continue
    const log = await fetchFileWithSizeLimit(
      file.url,
      signal,
      MAX_BIB_LOG_SIZE_PER_FILE
    )
    try {
      const { errors, warnings } = new BibLogParser(log, {
        maxErrors: 100,
      }).parse()
      accumulateResults({ errors, warnings }, 'BibTeX:')
    } catch {
      // BibLog parsing errors are ignored
    }
  }

  accumulateChktex(result.logEntries, data.chktex, normalize)

  result.logEntries.all = [
    ...result.logEntries.errors,
    ...result.logEntries.warnings,
    ...result.logEntries.typesetting,
  ]

  return result
}

/** Appends the server's chktex findings as errors/warnings with source "Syntax check". */
function accumulateChktex(
  logEntries: LogEntries,
  chktex: ChktexEntry[],
  normalize: (file: string) => string
) {
  for (const item of chktex) {
    const level = item.kind === 'Error' ? 'error' : 'warning'
    const entry: LogEntry = {
      key: generateEntryKey(),
      level,
      type: 'Syntax check',
      file: normalize(item.path),
      line: item.line,
      column: item.column,
      message: item.message,
      raw: `${item.path}:${item.line}:${item.column}: ${item.kind} ${item.code}: ${item.message}`,
      content: `chktex ${item.kind} ${item.code}`,
    }
    if (level === 'error') logEntries.errors.push(entry)
    else logEntries.warnings.push(entry)
  }
}

async function fetchFileWithSizeLimit(
  url: string,
  signal: AbortSignal | undefined,
  maxSize: number
) {
  let result = ''
  try {
    const abortController = new AbortController()
    signal?.addEventListener('abort', () => abortController.abort())
    const res = await fetch(url, {
      signal: abortController.signal,
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error('non-success response code')
    if (!res.body) return result
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      result += decoder.decode(value, { stream: true })
      if (size > maxSize) {
        abortController.abort()
        break
      }
    }
    result += decoder.decode()
  } catch (e) {
    debugConsole.warn('Failed to fetch log file', e)
    // ignore fetching error
  }
  return result
}

/**
 * Makes a log path relative to the project root: strips the compile
 * directory prefix (`logPathPrefix`) and any leading `./`.
 */
export function normalizeFilePath(path: string, logPathPrefix: string) {
  let normalized = path
  if (logPathPrefix && normalized.startsWith(logPathPrefix)) {
    normalized = normalized.slice(logPathPrefix.length)
  }
  // also strip the prefix when the log shows it without its trailing slash
  const bare = logPathPrefix.replace(/\/$/, '')
  if (bare && normalized.startsWith(bare + '/')) {
    normalized = normalized.slice(bare.length + 1)
  }
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2)
  }
  return normalized.replace(/\/\/+/g, '/')
}
