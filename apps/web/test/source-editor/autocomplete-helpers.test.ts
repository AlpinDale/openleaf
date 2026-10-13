import {
  type Completion,
  CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { supportExtend } from '@/features/source-editor/utils/autocomplete-helpers'

const context = new CompletionContext(
  EditorState.create({ doc: '\\text' }),
  5,
  false
)

function run(options: Completion[]) {
  const source = supportExtend(() => ({ from: 0, options }))
  return source(context) as CompletionResult
}

describe('supportExtend', () => {
  it('keeps one option per label even when details differ', () => {
    const result = run([
      { label: '\\textbf{}', detail: 'cmd' },
      { label: '\\textit{}' },
      { label: '\\textbf{}', detail: 'from package' },
    ])
    expect(result.options.map(o => [o.label, o.detail])).toEqual([
      ['\\textbf{}', 'cmd'],
      ['\\textit{}', undefined],
    ])
  })

  it('prefers the highest deduplicate priority for a shared key', () => {
    const result = run([
      { label: 'knuth (bib)', deduplicate: { key: 'knuth', priority: 1 } },
      { label: 'knuth (library)', deduplicate: { key: 'knuth', priority: 2 } },
    ])
    expect(result.options.map(o => o.label)).toEqual(['knuth (library)'])
  })
})
