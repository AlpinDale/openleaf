import { YDOC_CHANGES, YDOC_COMMENTS, YDOC_TEXTS } from '@openleaf/shared'
import * as Y from 'yjs'
import { replaceYText } from '../realtime/ydoc-text.js'

export type ProjectedFile = { kind: 'doc'; text: string } | { kind: 'file' }

/**
 * Projects a file replacement without touching the authoritative document.
 * The caller owns the returned clone; null means no Y state changes are needed.
 */
export function projectYState(
  live: Y.Doc,
  docIdsByPath: ReadonlyMap<string, string>,
  files: ReadonlyMap<string, ProjectedFile>,
  deleteMissing: boolean
): Y.Doc | null {
  const removed = new Set<string>()
  if (deleteMissing) {
    const known = new Set(docIdsByPath.values())
    for (const id of live.getMap<Y.Text>(YDOC_TEXTS).keys())
      if (!known.has(id)) removed.add(id)
  }
  for (const [path, id] of docIdsByPath) {
    const next = files.get(path)
    let remove = next ? next.kind !== 'doc' : deleteMissing
    if (!remove && !next) {
      for (
        let slash = path.lastIndexOf('/');
        slash > 0;
        slash = path.lastIndexOf('/', slash - 1)
      ) {
        if (files.has(path.slice(0, slash))) {
          remove = true
          break
        }
      }
    }
    if (remove) removed.add(id)
  }
  let hasDocs = false
  for (const file of files.values()) {
    if (file.kind === 'doc') {
      hasDocs = true
      break
    }
  }
  if (removed.size === 0 && !hasDocs) return null
  const projected = new Y.Doc()
  try {
    Y.applyUpdate(projected, Y.encodeStateAsUpdate(live))
    projected.clientID = live.clientID
    const texts = projected.getMap<Y.Text>(YDOC_TEXTS)
    for (const id of removed) texts.delete(id)
    for (const key of [YDOC_COMMENTS, YDOC_CHANGES]) {
      const map = projected.getMap<Y.Map<unknown>>(key)
      for (const [id, anchor] of map) {
        if (removed.has(anchor.get('docId') as string)) map.delete(id)
      }
    }
    for (const [path, file] of files) {
      if (file.kind !== 'doc') continue
      const id = docIdsByPath.get(path)
      const text = id && !removed.has(id) ? texts.get(id) : null
      if (text) replaceYText(text, file.text)
      else
        texts.set(
          id && !removed.has(id) ? id : crypto.randomUUID(),
          new Y.Text(file.text)
        )
    }
    return projected
  } catch (err) {
    projected.destroy()
    throw err
  }
}
