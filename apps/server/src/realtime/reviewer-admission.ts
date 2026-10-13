import {
  YDOC_CHANGES,
  YDOC_COMMENTS,
  YDOC_TEXTS,
  YDOC_TRACK_CHANGES,
} from '@openleaf/shared'
import { and, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import type { Db } from '../db/index.js'
import { commentThreads } from '../db/schema.js'

type DecodedUpdate = {
  structs: Y.AbstractStruct[]
  ds: { clients: Map<number, { clock: number; len: number }[]> }
}
type Location = { root: string; key: string | null }
type RecordSnapshot = { json: string; author: unknown; docId: unknown }
export type ReviewerSnapshot = {
  texts: Map<string, Y.Text | undefined>
  canonical: Map<string, string>
  changes: Map<string, RecordSnapshot | undefined>
  comments: Map<string, RecordSnapshot | undefined>
  track: Map<string, unknown>
}

function canonicalText(doc: Y.Doc, docId: string, userId: string): string {
  const text = doc.getMap<Y.Text>(YDOC_TEXTS).get(docId)
  if (!text) return ''
  const visible = text.toString()
  const inserts: { from: number; to: number }[] = []
  const deletes: { pos: number; text: string; ts: number; id: string }[] = []
  for (const [id, record] of doc.getMap<Y.Map<unknown>>(YDOC_CHANGES)) {
    if (
      !(record instanceof Y.Map) ||
      record.get('docId') !== docId ||
      record.get('userId') !== userId
    )
      continue
    const position = (field: string) => {
      const bytes = record.get(field)
      if (!(bytes instanceof Uint8Array))
        throw new Error('Invalid review anchor')
      const absolute = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(bytes),
        doc
      )
      if (
        !absolute ||
        absolute.type !== text ||
        absolute.index < 0 ||
        absolute.index > text.length
      ) {
        throw new Error('Review anchor is not in its document')
      }
      return absolute.index
    }
    if (record.get('type') === 'insert') {
      const from = position('start')
      const to = position('end')
      if (from > to) throw new Error('Invalid tracked insertion')
      if (from !== to) inserts.push({ from, to })
    } else if (record.get('type') === 'delete') {
      const deleted = record.get('text')
      const ts = record.get('ts')
      if (
        typeof deleted !== 'string' ||
        typeof ts !== 'number' ||
        !Number.isFinite(ts) ||
        Math.abs(ts) > 8.64e15
      )
        throw new Error('Invalid tracked deletion')
      deletes.push({ pos: position('pos'), text: deleted, ts, id })
    } else throw new Error('Invalid change type')
  }
  inserts.sort((a, b) => a.from - b.from || a.to - b.to)
  const chunks: string[] = []
  let previous = 0
  for (const insert of inserts) {
    if (insert.from < previous)
      throw new Error('Overlapping tracked insertions')
    chunks.push(visible.slice(previous, insert.from))
    previous = insert.to
  }
  chunks.push(visible.slice(previous))
  const stripped = chunks.join('')
  for (const deletion of deletes) {
    let removed = 0
    for (const insert of inserts) {
      if (insert.from >= deletion.pos) break
      removed += Math.min(insert.to, deletion.pos) - insert.from
    }
    deletion.pos -= removed
  }
  // Changes at the same position retain their creation order. Removing own
  // insertions first makes deleted baseline text inside such a range stable.
  deletes.sort(
    (a, b) => a.pos - b.pos || a.ts - b.ts || a.id.localeCompare(b.id)
  )
  chunks.length = 0
  previous = 0
  for (const deletion of deletes) {
    chunks.push(stripped.slice(previous, deletion.pos), deletion.text)
    previous = deletion.pos
  }
  chunks.push(stripped.slice(previous))
  return chunks.join('')
}

/** Find only touched documents/records; never clone all project text per edit. */
export function snapshotReviewerUpdate(
  doc: Y.Doc,
  decoded: DecodedUpdate,
  userId: string
): ReviewerSnapshot {
  const incoming = new Map<number, Y.AbstractStruct[]>()
  for (const struct of decoded.structs) {
    const list = incoming.get(struct.id.client) ?? []
    list.push(struct)
    incoming.set(struct.id.client, list)
  }
  const resolve = (id: Y.ID): Y.AbstractStruct | null => {
    for (const list of [
      doc.store.clients.get(id.client),
      incoming.get(id.client),
    ]) {
      if (!list?.length) continue
      let low = 0
      let high = list.length - 1
      while (low <= high) {
        const middle = (low + high) >>> 1
        const struct = list[middle]
        if (id.clock < struct.id.clock) high = middle - 1
        else if (id.clock >= struct.id.clock + struct.length) low = middle + 1
        else return struct
      }
    }
    return null
  }
  const locations = new WeakMap<Y.Item, Location>()
  const locate = (item: Y.Item, depth = 0): Location => {
    const cached = locations.get(item)
    if (cached) return cached
    if (depth > 32) throw new Error('Review update nesting is too deep')
    let location: Location
    if (typeof item.parent === 'string') {
      location = { root: item.parent, key: item.parentSub }
    } else if (item.parent instanceof Y.AbstractType) {
      location = item.parent._item
        ? locate(item.parent._item, depth + 1)
        : { root: Y.findRootTypeKey(item.parent), key: item.parentSub }
    } else {
      const parent =
        item.parent instanceof Y.ID
          ? item.parent
          : (item.origin ?? item.rightOrigin)
      const parentItem = parent ? resolve(parent) : null
      if (!(parentItem instanceof Y.Item))
        throw new Error('Reviewer update has unresolved dependencies')
      location = locate(parentItem, depth + 1)
    }
    locations.set(item, location)
    return location
  }
  const touched: Record<string, Set<string>> = {
    [YDOC_TEXTS]: new Set(),
    [YDOC_CHANGES]: new Set(),
    [YDOC_COMMENTS]: new Set(),
    [YDOC_TRACK_CHANGES]: new Set(),
  }
  const docs = new Set<string>()
  const collect = (struct: Y.AbstractStruct) => {
    if (!(struct instanceof Y.Item)) return
    const { root, key } = locate(struct)
    if (!Object.hasOwn(touched, root) || key === null)
      throw new Error('Unknown reviewer project key')
    touched[root].add(key)
    if (root === YDOC_TEXTS) docs.add(key)
    if (root === YDOC_CHANGES && struct.parentSub === 'docId') {
      for (const value of struct.content.getContent())
        if (typeof value === 'string') docs.add(value)
    }
  }
  for (const struct of decoded.structs) collect(struct)
  for (const [client, ranges] of decoded.ds.clients) {
    for (const range of ranges) {
      for (let clock = range.clock; clock < range.clock + range.len; ) {
        const struct = resolve(Y.createID(client, clock))
        if (!struct)
          throw new Error('Reviewer deletion has unresolved dependencies')
        collect(struct)
        clock = struct.id.clock + struct.length
      }
    }
  }
  const snapshot: ReviewerSnapshot = {
    texts: new Map(),
    canonical: new Map(),
    changes: new Map(),
    comments: new Map(),
    track: new Map(),
  }
  for (const root of [YDOC_CHANGES, YDOC_COMMENTS] as const) {
    for (const key of touched[root]) {
      const record = doc.getMap<Y.Map<unknown>>(root).get(key)
      const value =
        record instanceof Y.Map
          ? {
              json: JSON.stringify(record.toJSON()),
              author: record.get('userId'),
              docId: record.get('docId'),
            }
          : undefined
      snapshot[root === YDOC_CHANGES ? 'changes' : 'comments'].set(key, value)
      if (root === YDOC_CHANGES && typeof value?.docId === 'string')
        docs.add(value.docId)
    }
  }
  for (const key of touched[YDOC_TRACK_CHANGES])
    snapshot.track.set(key, doc.getMap(YDOC_TRACK_CHANGES).get(key))
  for (const id of docs) {
    snapshot.texts.set(id, doc.getMap<Y.Text>(YDOC_TEXTS).get(id))
    snapshot.canonical.set(id, canonicalText(doc, id, userId))
  }
  return snapshot
}

export function validateReviewerUpdate(
  doc: Y.Doc,
  before: ReviewerSnapshot,
  userId: string,
  db: Db,
  projectId: string
) {
  if (doc.store.pendingStructs || doc.store.pendingDs)
    throw new Error('Reviewer update has unresolved dependencies')
  for (const [key, value] of before.track) {
    if (key !== userId && value !== doc.getMap(YDOC_TRACK_CHANGES).get(key))
      throw new Error('Reviewer cannot change another tracking setting')
  }
  for (const [key, old] of before.changes) {
    const next = doc.getMap<Y.Map<unknown>>(YDOC_CHANGES).get(key)
    if (old && old.author !== userId) {
      if (
        !(next instanceof Y.Map) ||
        JSON.stringify(next.toJSON()) !== old.json
      )
        throw new Error('Reviewer cannot change another author record')
    } else if (
      next !== undefined &&
      (!(next instanceof Y.Map) || next.get('userId') !== userId)
    ) {
      throw new Error('Reviewer cannot forge a change author')
    }
    const nextDocId = next instanceof Y.Map ? next.get('docId') : undefined
    if (
      next instanceof Y.Map &&
      typeof nextDocId === 'string' &&
      !before.canonical.has(nextDocId)
    ) {
      throw new Error('Reviewer change targets an unaccounted document')
    }
  }
  for (const [key, old] of before.comments) {
    const next = doc.getMap<Y.Map<unknown>>(YDOC_COMMENTS).get(key)
    const thread = db
      .select({
        createdBy: commentThreads.createdBy,
        docId: commentThreads.docId,
      })
      .from(commentThreads)
      .where(
        and(eq(commentThreads.id, key), eq(commentThreads.projectId, projectId))
      )
      .get()
    const owner = thread?.createdBy ?? old?.author
    if ((old || thread) && owner !== userId) {
      const json =
        next instanceof Y.Map ? JSON.stringify(next.toJSON()) : undefined
      if (json !== old?.json)
        throw new Error('Reviewer cannot change another comment anchor')
    } else if (
      next !== undefined &&
      (!(next instanceof Y.Map) ||
        (!old && next.get('userId') !== userId) ||
        (next.get('userId') !== undefined && next.get('userId') !== userId))
    ) {
      throw new Error('Reviewer cannot forge a comment owner')
    }
    if (thread && next instanceof Y.Map && next.get('docId') !== thread.docId)
      throw new Error('Comment anchor must stay in its thread document')
  }
  for (const [id, expected] of before.canonical) {
    if (doc.getMap<Y.Text>(YDOC_TEXTS).get(id) !== before.texts.get(id))
      throw new Error('Reviewer cannot replace document identity')
    if (canonicalText(doc, id, userId) !== expected)
      throw new Error('Reviewer text must be fully tracked')
  }
}
