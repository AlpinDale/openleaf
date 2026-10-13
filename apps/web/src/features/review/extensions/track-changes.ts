import {
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { encodeAnchor, type Role } from '@openleaf/shared'
import { ySyncAnnotation } from 'y-codemirror.next'
import * as Y from 'yjs'
import { getHueForUserId } from '@/shared/utils/colors'
import {
  changesMap,
  isTrackingChanges,
  readChange,
  readChanges,
} from '../changes'

type FieldInsert = { id: string; userId: string; from: number; to: number }
type FieldDelete = { id: string; userId: string; pos: number; text: string }
export type TrackedChangesValue = {
  inserts: FieldInsert[]
  deletes: FieldDelete[]
}

/** Replaces the field's value with records freshly resolved from Y. */
export const refreshTrackedChangesEffect =
  StateEffect.define<TrackedChangesValue>()

/** The change records of the open doc, mapped through edits between refreshes. */
export const trackedChangesField = StateField.define<TrackedChangesValue>({
  create: () => ({ inserts: [], deletes: [] }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(refreshTrackedChangesEffect)) return effect.value
    }
    if (!tr.docChanged) return value
    return {
      inserts: value.inserts.map(insert => ({
        ...insert,
        from: tr.changes.mapPos(insert.from, 1),
        to: tr.changes.mapPos(insert.to, -1),
      })),
      deletes: value.deletes.map(del => ({
        ...del,
        pos: tr.changes.mapPos(del.pos, 1),
      })),
    }
  },
})

/** The change whose card is focused in the review panel, if any. */
export const setFocusedChangeEffect = StateEffect.define<string | null>()

const focusedChangeField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusedChangeEffect)) value = effect.value
    }
    return value
  },
})

function computeTrackedChanges(
  ydoc: Y.Doc,
  docId: string
): TrackedChangesValue {
  const value: TrackedChangesValue = { inserts: [], deletes: [] }
  for (const change of readChanges(ydoc, docId)) {
    if (change.type === 'insert') value.inserts.push(change)
    else value.deletes.push(change)
  }
  return value
}

export type TrackChangesCaptureOptions = {
  ydoc: Y.Doc
  ytext: Y.Text
  docId: string
  userId: string
  role: Role
}

function newRecord(fields: Record<string, unknown>) {
  const record = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(fields)) record.set(key, value)
  return record
}

/** Records the local edits of one transaction as tracked changes (plan M7 step 5). */
function captureTransaction(
  tr: Transaction,
  { ydoc, ytext, docId, userId, role }: TrackChangesCaptureOptions
) {
  const before = tr.startState.field(trackedChangesField)
  const myInserts = before.inserts.filter(i => i.userId === userId)
  const changes = changesMap(ydoc)

  const myDeletes = () => {
    const result: { id: string; record: Y.Map<unknown>; pos: number }[] = []
    for (const del of before.deletes) {
      if (del.userId !== userId) continue
      const record = changes.get(del.id)
      if (record instanceof Y.Map)
        result.push({ id: del.id, record, pos: del.pos })
    }
    return result
  }
  const myCurrentInserts = () => {
    const result: { record: Y.Map<unknown>; from: number; to: number }[] = []
    changes.forEach((record, id) => {
      if (!(record instanceof Y.Map) || record.get('docId') !== docId) return
      if (record.get('userId') !== userId) return
      const change = readChange(ydoc, id, record)
      if (change?.type === 'insert')
        result.push({ record, from: change.from, to: change.to })
    })
    return result
  }

  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    const ts = Date.now()
    if (toA > fromA) {
      // drop the characters of my own pending inserts: they vanish untracked
      let text = ''
      let cursor = fromA
      const overlapping = myInserts
        .filter(i => i.from < toA && i.to > fromA)
        .sort((a, b) => a.from - b.from)
      for (const insert of overlapping) {
        const start = Math.max(insert.from, fromA)
        if (start > cursor) text += tr.startState.doc.sliceString(cursor, start)
        cursor = Math.max(cursor, Math.min(insert.to, toA))
      }
      if (cursor < toA) text += tr.startState.doc.sliceString(cursor, toA)

      if (text) {
        const deletes = myDeletes()
        const backspace = deletes.find(d => d.pos === toA)
        const forward = backspace
          ? undefined
          : deletes.find(d => d.pos === fromA)
        const pos = encodeAnchor(ytext, fromB, 0)
        if (backspace) {
          backspace.record.set('text', text + backspace.record.get('text'))
          backspace.record.set('pos', pos)
          backspace.record.set('ts', ts)
        } else if (forward) {
          forward.record.set('text', forward.record.get('text') + text)
          forward.record.set('pos', pos)
          forward.record.set('ts', ts)
        } else {
          changes.set(
            crypto.randomUUID(),
            newRecord({ type: 'delete', docId, userId, ts, pos, text })
          )
        }
      }
    }

    if (toB > fromB) {
      const inserts = myCurrentInserts()
      const extendsEnd = inserts.find(i => i.to === fromB)
      const extendsStart = extendsEnd
        ? undefined
        : inserts.find(i => i.from === toB)
      if (extendsEnd) {
        extendsEnd.record.set('end', encodeAnchor(ytext, toB, -1))
        extendsEnd.record.set('ts', ts)
      } else if (extendsStart) {
        extendsStart.record.set('start', encodeAnchor(ytext, fromB, 0))
        extendsStart.record.set('ts', ts)
      } else if (!inserts.some(i => i.from <= fromB && toB <= i.to)) {
        changes.set(
          crypto.randomUUID(),
          newRecord({
            type: 'insert',
            docId,
            userId,
            ts,
            start: encodeAnchor(ytext, fromB, 0),
            end: encodeAnchor(ytext, toB, -1),
          })
        )
      }
    }
  })

  // inserts whose text is entirely gone
  changes.forEach((record, id) => {
    if (!(record instanceof Y.Map) || record.get('docId') !== docId) return
    if (role === 'reviewer' && record.get('userId') !== userId) return
    const change = readChange(ydoc, id, record)
    if (change?.type === 'insert' && change.from >= change.to)
      changes.delete(id)
  })
}

/**
 * Turns local edits into Y change records while track changes is on, and
 * keeps `trackedChangesField` in sync with Y. Must come after `yCollab`, with
 * local edits dispatched through `dispatchEditorTransactions` so text and
 * records share the sync plugin's transaction and undo origin.
 */
export function trackChangesCapture(
  options: TrackChangesCaptureOptions
): Extension {
  const { ydoc, docId, userId, role } = options
  const plugin = ViewPlugin.define(view => {
    let scheduled = false
    let destroyed = false
    const refresh = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (destroyed) return
        view.dispatch({
          effects: refreshTrackedChangesEffect.of(
            computeTrackedChanges(ydoc, docId)
          ),
        })
      })
    }
    const changes = changesMap(ydoc)
    changes.observeDeep(refresh)
    refresh()
    return {
      update(u: ViewUpdate) {
        if (!u.docChanged) return
        refresh()
        if (!isTrackingChanges(ydoc, userId, role)) return
        for (const tr of u.transactions) {
          if (!tr.docChanged || tr.annotation(ySyncAnnotation)) continue
          ydoc.transact(() => captureTransaction(tr, options))
        }
      },
      destroy() {
        destroyed = true
        changes.unobserveDeep(refresh)
      },
    }
  })
  return [trackedChangesField, focusedChangeField, plugin]
}

class DeletedTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly hue: number,
    readonly focused: boolean
  ) {
    super()
  }

  eq(other: DeletedTextWidget) {
    return (
      other.text === this.text &&
      other.hue === this.hue &&
      other.focused === this.focused
    )
  }

  toDOM() {
    const del = document.createElement('del')
    del.className = this.focused
      ? 'ol-tc-delete ol-tc-delete-focused'
      : 'ol-tc-delete'
    del.style.setProperty('--tc-hue', String(this.hue))
    del.textContent =
      this.text.length > 500 ? `${this.text.slice(0, 500)}…` : this.text
    return del
  }

  ignoreEvent() {
    return false
  }
}

/** Marks tracked inserts and shows tracked deletions as struck-through widgets. */
export const trackedChangesDecorations = EditorView.decorations.compute(
  [trackedChangesField, focusedChangeField],
  (state): DecorationSet => {
    const { inserts, deletes } = state.field(trackedChangesField)
    const focused = state.field(focusedChangeField)
    const length = state.doc.length
    const ranges: Range<Decoration>[] = []
    for (const insert of inserts) {
      const from = Math.min(insert.from, length)
      const to = Math.min(insert.to, length)
      if (to <= from) continue
      ranges.push(
        Decoration.mark({
          class:
            insert.id === focused
              ? 'ol-tc-insert ol-tc-insert-focused'
              : 'ol-tc-insert',
          attributes: {
            style: `--tc-hue:${getHueForUserId(insert.userId)}`,
            'data-change-id': insert.id,
          },
        }).range(from, to)
      )
    }
    for (const del of deletes) {
      ranges.push(
        Decoration.widget({
          widget: new DeletedTextWidget(
            del.text,
            getHueForUserId(del.userId),
            del.id === focused
          ),
          side: -1,
        }).range(Math.min(del.pos, length))
      )
    }
    return Decoration.set(ranges, true)
  }
)
