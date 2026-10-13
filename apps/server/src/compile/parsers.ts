import type { ChktexEntry, WordCount } from '@openleaf/shared'

// ---- SyncTeX (ported from Overleaf CLSI SynctexOutputParser.js) ----

type SynctexRecord = Record<string, string | number>

function splitLine(line: string): [string, string] {
  const splitIndex = line.indexOf(':')
  if (splitIndex === -1) return ['', line]
  return [line.slice(0, splitIndex).trim(), line.slice(splitIndex + 1).trim()]
}

function setInt(record: SynctexRecord, prop: string, value: string) {
  const n = Number.parseInt(value, 10)
  if (!Number.isNaN(n)) record[prop] = n
}

function setFloat(record: SynctexRecord, prop: string, value: string) {
  const n = Number.parseFloat(value)
  if (!Number.isNaN(n)) record[prop] = n
}

function parseOutput(
  output: string,
  processLine: (record: SynctexRecord, label: string, value: string) => void
): SynctexRecord[] {
  let current: SynctexRecord | null = null
  const records: SynctexRecord[] = []
  for (const line of output.split('\n')) {
    const [label, value] = splitLine(line)
    if (label === 'Output') {
      current = {}
      records.push(current)
      continue
    }
    if (current == null) continue
    processLine(current, label, value)
  }
  return records
}

export function parseSynctexViewOutput(output: string) {
  return parseOutput(output, (record, label, value) => {
    switch (label) {
      case 'Page':
        setInt(record, 'page', value)
        break
      case 'h':
        setFloat(record, 'h', value)
        break
      case 'v':
        setFloat(record, 'v', value)
        break
      case 'W':
        setFloat(record, 'width', value)
        break
      case 'H':
        setFloat(record, 'height', value)
        break
    }
  }).filter(
    (
      r
    ): r is {
      page: number
      h: number
      v: number
      width: number
      height: number
    } =>
      typeof r.page === 'number' &&
      typeof r.h === 'number' &&
      typeof r.v === 'number' &&
      typeof r.width === 'number' &&
      typeof r.height === 'number'
  )
}

export function parseSynctexEditOutput(output: string) {
  return parseOutput(output, (record, label, value) => {
    switch (label) {
      case 'Input':
        record.file = value
        break
      case 'Line':
        setInt(record, 'line', value)
        break
      case 'Column':
        setInt(record, 'column', value)
        break
    }
  }).filter(
    (r): r is { file: string; line: number; column: number } =>
      typeof r.file === 'string' && typeof r.line === 'number'
  )
}

// ---- chktex ----

/** Parses `%f:%l:%c:%k:%n:%m` lines. */
export function parseChktexOutput(output: string): ChktexEntry[] {
  const entries: ChktexEntry[] = []
  for (const line of output.split('\n')) {
    const match = /^(.*?):(\d+):(\d+):(Warning|Error|Message):(\d+):(.*)$/.exec(
      line
    )
    if (!match) continue
    entries.push({
      path: match[1].replace(/^\.\//, ''),
      line: Number(match[2]),
      column: Number(match[3]),
      kind: match[4] as ChktexEntry['kind'],
      code: Number(match[5]),
      message: match[6].trim(),
    })
  }
  return entries
}

// ---- texcount (ported from Overleaf CLSI CompileManager.js) ----

export function parseWordcountFromOutput(output: string): WordCount {
  const results: WordCount = {
    encode: '',
    textWords: 0,
    headWords: 0,
    outside: 0,
    headers: 0,
    elements: 0,
    mathInline: 0,
    mathDisplay: 0,
    errors: 0,
    messages: '',
  }
  for (const line of output.split('\n')) {
    const [data, info = ''] = line.split(':')
    if (data.indexOf('Encoding') > -1) results.encode = info.trim()
    if (data.indexOf('in text') > -1)
      results.textWords = Number.parseInt(info, 10)
    if (data.indexOf('in head') > -1)
      results.headWords = Number.parseInt(info, 10)
    if (data.indexOf('outside') > -1)
      results.outside = Number.parseInt(info, 10)
    if (data.indexOf('of head') > -1)
      results.headers = Number.parseInt(info, 10)
    if (data.indexOf('Number of floats/tables/figures') > -1) {
      results.elements = Number.parseInt(info, 10)
    }
    if (data.indexOf('Number of math inlines') > -1) {
      results.mathInline = Number.parseInt(info, 10)
    }
    if (data.indexOf('Number of math displayed') > -1) {
      results.mathDisplay = Number.parseInt(info, 10)
    }
    if (data === '(errors') results.errors = Number.parseInt(info, 10)
    if (line.indexOf('!!! ') > -1) results.messages += `${line}\n`
  }
  return results
}
