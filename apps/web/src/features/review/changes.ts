import {
  encodeAnchor,
  type Role,
  resolveAnchor,
  TRACK_CHANGES_ALL,
  YDOC_CHANGES,
  YDOC_COMMENTS,
  YDOC_TRACK_CHANGES,
} from '@openleaf/shared'
import * as Y from 'yjs'

/** A tracked insertion, resolved to current indices in its doc's Y.Text. */
export type TrackedInsert = {
  id: string
  type: 'insert'
  docId: string
  userId: string
  ts: number
  from: number
  to: number
}

/** A tracked deletion: `text` was removed at `pos`. */
export type TrackedDelete = {
  id: string
  type: 'delete'
  docId: string
  userId: string
  ts: number
  pos: number
  text: string
}

export type TrackedChange = TrackedInsert | TrackedDelete

export const changesMap = (ydoc: Y.Doc) =>
  ydoc.getMap<Y.Map<unknown>>(YDOC_CHANGES)
export const commentsMap = (ydoc: Y.Doc) =>
  ydoc.getMap<Y.Map<unknown>>(YDOC_COMMENTS)
export const trackChangesMap = (ydoc: Y.Doc) =>
  ydoc.getMap<boolean>(YDOC_TRACK_CHANGES)

/** Resolves one change record; `null` when it's malformed or its anchors are gone. */
export function readChange(
  ydoc: Y.Doc,
  id: string,
  record: Y.Map<unknown>
): TrackedChange | null {
  const docId = record.get('docId')
  const userId = record.get('userId')
  const ts = record.get('ts')
  if (typeof docId !== 'string' || typeof userId !== 'string') return null
  const base = { id, docId, userId, ts: typeof ts === 'number' ? ts : 0 }
  const type = record.get('type')
  if (type === 'insert') {
    const start = record.get('start')
    const end = record.get('end')
    if (!(start instanceof Uint8Array) || !(end instanceof Uint8Array))
      return null
    const from = resolveAnchor(ydoc, start)
    const to = resolveAnchor(ydoc, end)
    if (from === null || to === null) return null
    return { ...base, type, from, to: Math.max(from, to) }
  }
  if (type === 'delete') {
    const posBytes = record.get('pos')
    const text = record.get('text')
    if (!(posBytes instanceof Uint8Array) || typeof text !== 'string')
      return null
    const pos = resolveAnchor(ydoc, posBytes)
    if (pos === null) return null
    return { ...base, type, pos, text }
  }
  return null
}

/** Every change record, optionally limited to one doc, sorted by position. */
export function readChanges(ydoc: Y.Doc, docId?: string): TrackedChange[] {
  const result: TrackedChange[] = []
  changesMap(ydoc).forEach((record, id) => {
    if (!(record instanceof Y.Map)) return
    if (docId !== undefined && record.get('docId') !== docId) return
    const change = readChange(ydoc, id, record)
    if (change) result.push(change)
  })
  return result.sort((a, b) => changeFrom(a) - changeFrom(b))
}

export const changeFrom = (change: TrackedChange) =>
  change.type === 'insert' ? change.from : change.pos
export const changeTo = (change: TrackedChange) =>
  change.type === 'insert' ? change.to : change.pos

export type CommentAnchor = {
  id: string
  docId: string
  from: number
  to: number
}

/** Resolved comment anchors, optionally limited to one doc. */
export function readCommentAnchors(
  ydoc: Y.Doc,
  docId?: string
): CommentAnchor[] {
  const result: CommentAnchor[] = []
  commentsMap(ydoc).forEach((record, id) => {
    if (!(record instanceof Y.Map)) return
    const recordDocId = record.get('docId')
    if (typeof recordDocId !== 'string') return
    if (docId !== undefined && recordDocId !== docId) return
    const start = record.get('start')
    const end = record.get('end')
    if (!(start instanceof Uint8Array) || !(end instanceof Uint8Array)) return
    const from = resolveAnchor(ydoc, start)
    const to = resolveAnchor(ydoc, end)
    if (from === null || to === null) return
    result.push({ id, docId: recordDocId, from, to: Math.max(from, to) })
  })
  return result
}

/** Writes the Y anchor for a new comment thread. */
export function addCommentAnchor(
  ydoc: Y.Doc,
  ytext: Y.Text,
  id: string,
  docId: string,
  from: number,
  to: number,
  userId: string
) {
  ydoc.transact(() => {
    const record = new Y.Map<unknown>()
    record.set('docId', docId)
    record.set('userId', userId)
    record.set('start', encodeAnchor(ytext, from, 0))
    record.set('end', encodeAnchor(ytext, to, -1))
    commentsMap(ydoc).set(id, record)
  })
}

export function removeCommentAnchor(ydoc: Y.Doc, id: string) {
  ydoc.transact(() => commentsMap(ydoc).delete(id))
}

/** Plan M7 step 4: tracking is on for everyone, for this user, or forced for reviewers. */
export function isTrackingChanges(ydoc: Y.Doc, userId: string, role: Role) {
  const map = trackChangesMap(ydoc)
  return (
    map.get(TRACK_CHANGES_ALL) === true ||
    map.get(userId) === true ||
    role === 'reviewer'
  )
}
