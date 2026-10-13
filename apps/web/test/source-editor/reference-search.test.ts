import { describe, expect, it } from 'vitest'
import {
  type ReferenceEntry,
  searchReferenceEntries,
} from '@/features/source-editor/languages/latex/completions/references'

const entries: ReferenceEntry[] = [
  {
    key: 'knuth1984',
    title: 'The {\\TeX}book',
    author: 'Donald E. Knuth',
    year: '1984',
  },
  {
    key: 'lamport1994',
    title: 'LaTeX: A Document Preparation System',
    author: 'Leslie Lamport',
    year: '1994',
  },
  {
    key: 'texguide',
    title: 'A Guide',
    author: 'Someone Else',
    year: '2001',
  },
]

const keys = (query: string, mode: 'advanced' | 'simple') =>
  searchReferenceEntries(entries, query, mode).map(entry => entry.key)

describe('reference search', () => {
  it('simple mode matches key prefixes only', () => {
    expect(keys('la', 'simple')).toEqual(['lamport1994'])
    expect(keys('LA', 'simple')).toEqual(['lamport1994'])
    expect(keys('Leslie', 'simple')).toEqual([])
    expect(keys('1984', 'simple')).toEqual([])
    expect(keys('', 'simple')).toEqual(['knuth1984', 'lamport1994', 'texguide'])
  })

  it('advanced mode matches keys, authors and titles', () => {
    expect(keys('Leslie', 'advanced')).toEqual(['lamport1994'])
    expect(keys('document preparation', 'advanced')).toEqual(['lamport1994'])
    // BibTeX markup in titles is ignored
    expect(keys('texbook', 'advanced')).toEqual(['knuth1984'])
  })

  it('advanced mode ranks key matches above title matches', () => {
    expect(keys('tex', 'advanced')).toEqual([
      'texguide',
      'knuth1984',
      'lamport1994',
    ])
  })

  it('advanced mode falls back to fuzzy key matches', () => {
    expect(keys('lmp94', 'advanced')).toEqual(['lamport1994'])
    expect(keys('zzz', 'advanced')).toEqual([])
  })
})
