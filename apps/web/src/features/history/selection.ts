import type { HistoryVersion } from '@openleaf/shared'

export type ChangeOp = HistoryVersion['changes'][number]['op']

/**
 * `range`: versions `newest`..`oldest` inclusive, compared from `oldest`'s
 * parent (clicking or shift-clicking versions).
 * `compare`: the snapshot `fromOid` (`null` = before the first version)
 * against the snapshot `toOid` (the ⋮ menu's compare actions).
 */
export type HistorySelection =
  | { kind: 'range'; newestOid: string; oldestOid: string }
  | { kind: 'compare'; fromOid: string | null; toOid: string }

export type ResolvedSelection = {
  comparing: boolean
  fromOid: string | null
  toOid: string
  /** Versions whose changes make up the diff, newest first. */
  versions: HistoryVersion[]
}

/**
 * Position of `oid` in the newest-first list. A `from` snapshot that isn't
 * loaded (the parent of the oldest loaded version, or `null` before the first
 * version) is older than every loaded version.
 */
function fromIndex(versions: HistoryVersion[], oid: string | null): number {
  const index = oid ? versions.findIndex(v => v.oid === oid) : -1
  return index < 0 ? versions.length : index
}

export function resolveSelection(
  versions: HistoryVersion[],
  selection: HistorySelection | null
): ResolvedSelection | null {
  if (!selection) return null
  if (selection.kind === 'compare') {
    const to = versions.findIndex(v => v.oid === selection.toOid)
    const from = fromIndex(versions, selection.fromOid)
    if (to < 0 || from <= to) return null
    return {
      comparing: true,
      fromOid: selection.fromOid,
      toOid: selection.toOid,
      versions: versions.slice(to, from),
    }
  }
  const newest = versions.findIndex(v => v.oid === selection.newestOid)
  const oldest = versions.findIndex(v => v.oid === selection.oldestOid)
  if (newest < 0 || oldest < 0) return null
  return {
    comparing: false,
    fromOid: versions[oldest].parentOid,
    toOid: versions[newest].oid,
    versions: versions.slice(newest, oldest + 1),
  }
}

/**
 * "Compare from this version": `oid`'s snapshot becomes the old side and the
 * current new side stays. `null` when `oid` isn't older than the new side.
 */
export function compareFrom(
  versions: HistoryVersion[],
  current: ResolvedSelection | null,
  oid: string
): HistorySelection | null {
  if (!current) return null
  const index = versions.findIndex(v => v.oid === oid)
  const to = versions.findIndex(v => v.oid === current.toOid)
  if (index < 0 || to < 0 || index <= to) return null
  return { kind: 'compare', fromOid: oid, toOid: current.toOid }
}

/**
 * "Compare up to this version": `oid`'s snapshot becomes the new side and the
 * current old side stays. `null` when `oid` isn't newer than the old side.
 */
export function compareUpTo(
  versions: HistoryVersion[],
  current: ResolvedSelection | null,
  oid: string
): HistorySelection | null {
  if (!current) return null
  const index = versions.findIndex(v => v.oid === oid)
  if (index < 0 || index >= fromIndex(versions, current.fromOid)) return null
  return { kind: 'compare', fromOid: current.fromOid, toOid: oid }
}

/**
 * Net per-path change over `versions` (newest first), e.g. added then
 * deleted cancels out and deleted then added is a modification.
 */
export function combineChanges(
  versions: HistoryVersion[]
): Map<string, ChangeOp> {
  const first = new Map<string, ChangeOp>()
  const last = new Map<string, ChangeOp>()
  for (let i = versions.length - 1; i >= 0; i--) {
    for (const { path, op } of versions[i].changes) {
      if (!first.has(path)) first.set(path, op)
      last.set(path, op)
    }
  }
  const result = new Map<string, ChangeOp>()
  for (const [path, firstOp] of first) {
    const lastOp = last.get(path)!
    const existedBefore = firstOp !== 'added'
    const existsAfter = lastOp !== 'deleted'
    if (existedBefore && existsAfter) result.set(path, 'modified')
    else if (existsAfter) result.set(path, 'added')
    else if (existedBefore) result.set(path, 'deleted')
  }
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b)))
}
