import type { Role } from '@openleaf/shared'
import {
  YDOC_CHANGES,
  YDOC_COMMENTS,
  YDOC_TEXTS,
  YDOC_TRACK_CHANGES,
} from '@openleaf/shared'
import { and, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import type { Db } from '../db/index.js'
import { entries, projectMembers } from '../db/schema.js'
import { tooLarge } from '../errors.js'
import {
  snapshotReviewerUpdate,
  validateReviewerUpdate,
} from './reviewer-admission.js'

const ROOTS = {
  [YDOC_TEXTS]: true,
  [YDOC_COMMENTS]: true,
  [YDOC_CHANGES]: true,
  [YDOC_TRACK_CHANGES]: true,
} as const
const COMMENT_FIELDS: Record<string, true> = {
  docId: true,
  start: true,
  end: true,
  userId: true,
}
const CHANGE_FIELDS: Record<string, true> = {
  docId: true,
  type: true,
  userId: true,
  ts: true,
  start: true,
  end: true,
  pos: true,
  text: true,
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
type Root = keyof typeof ROOTS

function structureCount(doc: Y.Doc): number {
  let count = doc.store.clients.size
  for (const structs of doc.store.clients.values()) count += structs.length
  // Missing dependencies are retained by Yjs even though no visible map or
  // text has changed. Count both pending structs and pending delete metadata.
  for (const pending of [
    doc.store.pendingStructs?.update,
    doc.store.pendingDs,
  ]) {
    if (!pending) continue
    const decoded = Y.decodeUpdateV2(pending)
    count += decoded.structs.length + decoded.ds.clients.size
    for (const ranges of decoded.ds.clients.values()) count += ranges.length
  }
  return count
}

/** Also used by initial project creation and server-side mutation preflights. */
export function assertProjectStateWithinLimit(
  doc: Y.Doc,
  maxBytes: number
): Uint8Array {
  // encodeStateAsUpdate includes pending structs and delete sets, not only
  // materialized text. A tiny out-of-order update cannot evade the budget.
  const state = Y.encodeStateAsUpdate(doc)
  if (
    state.byteLength > maxBytes ||
    structureCount(doc) > Math.max(1, Math.floor(maxBytes / 64))
  ) {
    throw tooLarge('Project realtime state is too large')
  }
  return state
}

/**
 * A disposable admission mirror: rejected updates never touch the live doc.
 * The caller serializes admission through live integration for each document.
 */
export class ProjectAdmission {
  private shadow!: Y.Doc
  private bytes = 0
  private structures = 0
  private collecting = false
  private invalidText = false
  private readonly changed: Record<Root, Set<string>> = {
    [YDOC_TEXTS]: new Set(),
    [YDOC_COMMENTS]: new Set(),
    [YDOC_CHANGES]: new Set(),
    [YDOC_TRACK_CHANGES]: new Set(),
  }

  constructor(
    private readonly live: Y.Doc,
    private readonly db: Db,
    private readonly projectId: string,
    private readonly maxBytes: number
  ) {
    this.rebuild()
    live.on('update', this.mirror)
  }

  private readonly mirror = (update: Uint8Array) => {
    Y.applyUpdate(this.shadow, update)
  }

  private rebuild() {
    this.invalidText = false
    for (const keys of Object.values(this.changed)) keys.clear()
    const state = assertProjectStateWithinLimit(this.live, this.maxBytes)
    this.shadow?.destroy()
    this.shadow = new Y.Doc()
    Y.applyUpdate(this.shadow, state)
    this.bytes = state.byteLength
    this.structures = structureCount(this.shadow)
    this.shadow.on('update', update => {
      if (this.collecting) return
      // Already-admitted live integration is a duplicate and emits no shadow
      // update. New server-side transactions must consume the same budget.
      const decoded = Y.decodeUpdate(update)
      this.bytes += update.byteLength
      this.structures += decoded.structs.length + decoded.ds.clients.size
      for (const ranges of decoded.ds.clients.values())
        this.structures += ranges.length
    })
    for (const root of Object.keys(ROOTS) as Root[]) {
      this.shadow.getMap(root).observeDeep(events => {
        if (!this.collecting) return
        for (const event of events) {
          if (event.path.length === 0 && event instanceof Y.YMapEvent) {
            for (const key of event.keysChanged) this.changed[root].add(key)
          } else if (typeof event.path[0] === 'string') {
            this.changed[root].add(event.path[0])
          }
          if (
            event instanceof Y.YTextEvent &&
            event.delta.some(
              delta =>
                (delta.insert !== undefined &&
                  typeof delta.insert !== 'string') ||
                delta.attributes !== undefined
            )
          )
            this.invalidText = true
        }
      })
    }
    for (const root of Object.keys(ROOTS) as Root[]) {
      for (const key of this.shadow.getMap(root).keys())
        this.changed[root].add(key)
    }
    for (const value of this.shadow.getMap(YDOC_TEXTS).values()) {
      if (
        value instanceof Y.Text &&
        value
          .toDelta()
          .some(
            (delta: { insert?: unknown; attributes?: unknown }) =>
              typeof delta.insert !== 'string' || delta.attributes !== undefined
          )
      )
        this.invalidText = true
    }
    this.validateChangedKeys()
    for (const keys of Object.values(this.changed)) keys.clear()
    this.invalidText = false
  }

  private knownDoc(id: unknown): id is string {
    return (
      typeof id === 'string' &&
      !!this.db
        .select({ id: entries.id })
        .from(entries)
        .where(
          and(
            eq(entries.id, id),
            eq(entries.projectId, this.projectId),
            eq(entries.kind, 'doc')
          )
        )
        .get()
    )
  }

  private anchor(value: unknown, docId: string): boolean {
    if (!(value instanceof Uint8Array) || value.byteLength > 256) return false
    try {
      const position = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(value),
        this.shadow
      )
      const text = this.shadow.getMap<Y.Text>(YDOC_TEXTS).get(docId)
      // Deleted/offline targets may legitimately be unresolved. A resolved
      // anchor must belong to the advertised document, not another Y type.
      return (
        position === null ||
        (text !== undefined &&
          position.type === text &&
          position.index >= 0 &&
          position.index <= text.length)
      )
    } catch {
      return false
    }
  }

  private validateChangedKeys() {
    if (this.invalidText) throw new Error('Only plain text can be edited')
    for (const root of this.shadow.share.keys()) {
      if (!Object.hasOwn(ROOTS, root)) throw new Error('Unknown project map')
    }
    for (const key of this.changed[YDOC_TEXTS]) {
      const value = this.shadow.getMap(YDOC_TEXTS).get(key)
      if (value === undefined) continue
      if (!this.knownDoc(key) || !(value instanceof Y.Text))
        throw new Error('Unknown document text')
    }
    for (const root of [YDOC_COMMENTS, YDOC_CHANGES] as const) {
      for (const key of this.changed[root]) {
        const value = this.shadow.getMap(root).get(key)
        if (value === undefined) continue
        const docId = value instanceof Y.Map ? value.get('docId') : undefined
        if (
          !UUID.test(key) ||
          !(value instanceof Y.Map) ||
          !this.knownDoc(docId)
        ) {
          throw new Error('Invalid project annotation')
        }
        const fields = root === YDOC_COMMENTS ? COMMENT_FIELDS : CHANGE_FIELDS
        for (const field of value.keys()) {
          if (!Object.hasOwn(fields, field))
            throw new Error('Unknown annotation field')
        }
        if (root === YDOC_COMMENTS) {
          if (
            !this.anchor(value.get('start'), docId) ||
            !this.anchor(value.get('end'), docId)
          )
            throw new Error('Invalid comment anchors')
          const userId = value.get('userId')
          if (
            userId !== undefined &&
            (typeof userId !== 'string' || !UUID.test(userId))
          )
            throw new Error('Invalid comment owner')
        } else {
          if (
            typeof value.get('userId') !== 'string' ||
            !UUID.test(value.get('userId')) ||
            typeof value.get('ts') !== 'number' ||
            !Number.isFinite(value.get('ts')) ||
            Math.abs(value.get('ts')) > 8.64e15
          )
            throw new Error('Invalid change author')
          for (const field of ['start', 'end', 'pos']) {
            if (value.has(field) && !this.anchor(value.get(field), docId))
              throw new Error('Invalid change anchor')
          }
          if (value.has('text') && typeof value.get('text') !== 'string')
            throw new Error('Invalid deleted text')
          if (value.get('type') === 'insert') {
            if (
              !this.anchor(value.get('start'), docId) ||
              !this.anchor(value.get('end'), docId)
            )
              throw new Error('Invalid insert anchors')
          } else if (value.get('type') === 'delete') {
            if (
              !this.anchor(value.get('pos'), docId) ||
              typeof value.get('text') !== 'string'
            )
              throw new Error('Invalid deleted text')
          } else throw new Error('Invalid change type')
        }
      }
    }
    for (const key of this.changed[YDOC_TRACK_CHANGES]) {
      const value = this.shadow.getMap(YDOC_TRACK_CHANGES).get(key)
      const member =
        key === '__all__'
          ? true
          : this.db
              .select({ userId: projectMembers.userId })
              .from(projectMembers)
              .where(
                and(
                  eq(projectMembers.projectId, this.projectId),
                  eq(projectMembers.userId, key)
                )
              )
              .get()
      if (value !== undefined && (!member || typeof value !== 'boolean')) {
        throw new Error('Invalid track-changes setting')
      }
    }
  }

  private integrated(decoded: {
    structs: Y.AbstractStruct[]
    ds: { clients: Map<number, { clock: number; len: number }[]> }
  }) {
    if (
      decoded.structs.some(
        struct =>
          struct.id.clock + struct.length >
          Y.getState(this.shadow.store, struct.id.client)
      )
    )
      return false
    for (const [client, ranges] of decoded.ds.clients) {
      const structs = this.shadow.store.clients.get(client)
      for (const range of ranges) {
        if (
          !structs ||
          range.clock + range.len > Y.getState(this.shadow.store, client)
        )
          return false
        let index = Y.findIndexSS(structs, range.clock)
        while (
          index < structs.length &&
          structs[index].id.clock < range.clock + range.len
        ) {
          if (!structs[index].deleted) return false
          index++
        }
      }
    }
    return true
  }

  admit(update: Uint8Array, actor: { userId: string; role: Role }) {
    let decoded = Y.decodeUpdate(update)
    // Reject unknown root names before even allocating them in the mirror.
    for (const struct of decoded.structs) {
      if (
        struct instanceof Y.Item &&
        typeof struct.parent === 'string' &&
        !Object.hasOwn(ROOTS, struct.parent)
      ) {
        throw new Error('Unknown project map')
      }
    }
    // Full offline syncs carry old structs too. Do not charge duplicate state
    // forever, or idle reconnects would exhaust the project budget.
    if (this.integrated(decoded)) return
    if (
      decoded.structs.some(
        struct =>
          struct.id.clock < Y.getState(this.shadow.store, struct.id.client)
      )
    ) {
      update = Y.diffUpdate(update, Y.encodeStateVector(this.shadow))
      decoded = Y.decodeUpdate(update)
    }
    let metadata = decoded.structs.length + decoded.ds.clients.size
    for (const ranges of decoded.ds.clients.values()) metadata += ranges.length
    const structureLimit = Math.max(1, Math.floor(this.maxBytes / 64))
    if (
      update.byteLength > this.maxBytes ||
      decoded.structs.length > structureLimit
    )
      throw tooLarge('Project realtime state is too large')
    const needsCheckpoint =
      this.bytes + update.byteLength > this.maxBytes ||
      this.structures + metadata > structureLimit
    for (const keys of Object.values(this.changed)) keys.clear()
    this.invalidText = false
    const reviewer =
      actor.role === 'reviewer'
        ? snapshotReviewerUpdate(this.shadow, decoded, actor.userId)
        : null
    this.collecting = true
    try {
      Y.applyUpdate(this.shadow, update)
      this.validateChangedKeys()
      if (reviewer)
        validateReviewerUpdate(
          this.shadow,
          reviewer,
          actor.userId,
          this.db,
          this.projectId
        )
      if (needsCheckpoint) {
        // Near the limit, validate actual encoded state rather than rejecting
        // harmless duplicate delete metadata or GC-merging transactions.
        this.bytes = assertProjectStateWithinLimit(
          this.shadow,
          this.maxBytes
        ).byteLength
        this.structures = structureCount(this.shadow)
      } else {
        this.bytes += update.byteLength
        this.structures += metadata
      }
    } catch (error) {
      this.collecting = false
      this.rebuild()
      throw error
    } finally {
      this.collecting = false
    }
  }

  checkpoint(state: Uint8Array) {
    // Store-time compaction removes conservative double-counting of repeated
    // offline sync and merged structs without a full scan on every keystroke.
    this.bytes = state.byteLength
    this.structures = structureCount(this.shadow)
  }

  destroy() {
    this.live.off('update', this.mirror)
    this.shadow.destroy()
  }
}
