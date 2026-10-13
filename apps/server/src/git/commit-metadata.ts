import type { ReadCommitResult } from 'isomorphic-git'

/** Parses bounded commit contents without treating Unicode separators as LF headers. */
export function parseHistoryCommit(
  oid: string,
  payload: string
): Pick<ReadCommitResult, 'oid' | 'commit'> {
  const separator = payload.indexOf('\n\n')
  if (separator < 0) throw new Error('Invalid commit headers')
  const headers = payload.slice(0, separator).split('\n')
  const trees = headers.filter(line => line.startsWith('tree '))
  const tree = trees[0]?.slice(5)
  const parent = headers
    .filter(line => line.startsWith('parent '))
    .map(line => line.slice(7))
  if (
    trees.length !== 1 ||
    !tree ||
    !/^[0-9a-f]{40}$/i.test(tree) ||
    parent.some(value => !/^[0-9a-f]{40}$/i.test(value))
  )
    throw new Error('Invalid commit references')
  const identity = (
    key: 'author' | 'committer'
  ): ReadCommitResult['commit']['author'] => {
    const fields = headers.filter(line => line.startsWith(`${key} `))
    const value = fields[0]?.slice(key.length + 1)
    const match =
      value && /^([\s\S]*) <([\s\S]*)> (-?\d+) ([+-]\d{4})$/.exec(value)
    if (fields.length !== 1 || !match)
      throw new Error('Invalid commit identity')
    const timestamp = Number(match[3])
    if (!Number.isSafeInteger(timestamp) || Math.abs(timestamp) > 8.64e12)
      throw new Error('Invalid commit timestamp')
    const minutes =
      Number(match[4].slice(1, 3)) * 60 + Number(match[4].slice(3))
    return {
      name: match[1],
      email: match[2],
      timestamp,
      timezoneOffset: match[4][0] === '+' ? -minutes : minutes,
    }
  }
  return {
    oid,
    commit: {
      tree: tree.toLowerCase(),
      parent: parent.map(value => value.toLowerCase()),
      author: identity('author'),
      committer: identity('committer'),
      message: payload.slice(separator + 2),
    },
  }
}
