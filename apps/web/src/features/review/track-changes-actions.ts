import { YDOC_TEXTS } from '@openleaf/shared'
import * as Y from 'yjs'
import {
  changeFrom,
  changesMap,
  changeTo,
  readChange,
  readChanges,
} from './changes'

/** Origin of accept/reject transactions; no UndoManager tracks it. */
const reviewActionOrigin = { reviewAction: true }

/** Accepting keeps the text as it is and drops the records. */
export function acceptChanges(ydoc: Y.Doc, ids: readonly string[]) {
  const changes = changesMap(ydoc)
  ydoc.transact(() => {
    for (const id of ids) changes.delete(id)
  }, reviewActionOrigin)
}

/** Rejecting removes tracked insertions and restores tracked deletions. */
export function rejectChanges(ydoc: Y.Doc, ids: readonly string[]) {
  const changes = changesMap(ydoc)
  const texts = ydoc.getMap<Y.Text>(YDOC_TEXTS)
  ydoc.transact(() => {
    for (const id of ids) {
      const record = changes.get(id)
      if (!(record instanceof Y.Map)) continue
      // resolved inside the transaction, after earlier rejections moved text
      const change = readChange(ydoc, id, record)
      const ytext = change ? texts.get(change.docId) : undefined
      if (change && ytext) {
        if (change.type === 'insert') {
          if (change.to > change.from)
            ytext.delete(change.from, change.to - change.from)
        } else {
          ytext.insert(change.pos, change.text)
        }
      }
      changes.delete(id)
    }
  }, reviewActionOrigin)
}

/** Ids of every change in one doc, or in the whole project. */
export function changeIds(ydoc: Y.Doc, docId?: string): string[] {
  return readChanges(ydoc, docId).map(change => change.id)
}

/** Ids of the changes in `docId` that intersect `[from, to]`. */
export function changeIdsInRange(
  ydoc: Y.Doc,
  docId: string,
  from: number,
  to: number
): string[] {
  return readChanges(ydoc, docId)
    .filter(change => changeFrom(change) <= to && changeTo(change) >= from)
    .map(change => change.id)
}
