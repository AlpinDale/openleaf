import { describe, expect, it } from 'vitest'
import { parseHistoryCommit } from '../src/git/commit-metadata.js'

const oid = 'a'.repeat(40)
const tree = 'b'.repeat(40)
const author = 'author Ada <ada@example.com> 1 +0230'
const committer = 'committer Grace <grace@example.com> 2 -0430'
const payload = `tree ${tree}\n${author}\n${committer}\n\nMessage\n`

describe('commit metadata admission', () => {
  it('preserves Unicode identities and parses timezone direction and message bytes', () => {
    const unicode = payload.replace('Ada', 'Ada\u2028Unicode\u2029name')
    expect(parseHistoryCommit(oid, unicode)).toMatchObject({
      oid,
      commit: {
        tree,
        parent: [],
        author: {
          name: 'Ada\u2028Unicode\u2029name',
          timestamp: 1,
          timezoneOffset: -150,
        },
        committer: { name: 'Grace', timestamp: 2, timezoneOffset: 270 },
        message: 'Message\n',
      },
    })
  })

  it.each([
    ['missing author', payload.replace(`${author}\n`, '')],
    ['missing committer', payload.replace(`${committer}\n`, '')],
    [
      'malformed author',
      payload.replace(author, 'author missing identity fields'),
    ],
    [
      'malformed committer',
      payload.replace(committer, 'committer missing identity fields'),
    ],
    ['duplicate author', payload.replace(author, `${author}\n${author}`)],
    [
      'duplicate committer',
      payload.replace(committer, `${committer}\n${committer}`),
    ],
    ['invalid tree', payload.replace(tree, 'invalid')],
    [
      'nonfinite timestamp',
      payload.replace(' 1 +0230', ` ${'9'.repeat(400)} +0230`),
    ],
    [
      'timestamp outside Date range',
      payload.replace(' 1 +0230', ' 8640000000001 +0230'),
    ],
    [
      'negative timestamp outside Date range',
      payload.replace(' 1 +0230', ' -8640000000001 +0230'),
    ],
  ])('rejects %s before refs can be accepted', (_name, invalid) => {
    expect(() => parseHistoryCommit(oid, invalid)).toThrow()
  })
})
