import { YDOC_TEXTS } from '@openleaf/shared'
import type * as Y from 'yjs'
import type { AppContext } from '../context.js'
import { notFound } from '../errors.js'
import { projectLock } from './locks.js'
import { buildPaths, type EntryRow, loadEntries } from './model.js'

export type SnapshotEntry =
  | { path: string; id: string; kind: 'doc'; text: string }
  | {
      path: string
      id: string
      kind: 'file'
      hash: string
      size: number
      gitOid: string
    }
  | { path: string; id: string; kind: 'folder' }

export type ProjectSnapshot = {
  rows: EntryRow[]
  entries: SnapshotEntry[]
}

/** Current paths and contents (doc text read from the live Y.Doc in one transaction). */
export function projectSnapshot(
  ctx: AppContext,
  projectId: string
): Promise<ProjectSnapshot> {
  return projectLock(projectId).runExclusive(() =>
    projectSnapshotLocked(ctx, projectId)
  )
}

/** Caller holds projectLock until it finishes reading the snapshot's blobs. */
export async function projectSnapshotLocked(
  ctx: AppContext,
  projectId: string
): Promise<ProjectSnapshot> {
  const rows = loadEntries(ctx.db, projectId)
  if (!rows.some(row => row.parentId === null))
    throw notFound('Project not found')
  const texts = await ctx.realtime.withProjectDoc(projectId, doc => {
    const map = doc.getMap<Y.Text>(YDOC_TEXTS)
    const out = new Map<string, string>()
    for (const row of rows) {
      if (row.kind === 'doc') out.set(row.id, map.get(row.id)?.toString() ?? '')
    }
    return out
  })
  const paths = buildPaths(rows)
  const result: SnapshotEntry[] = []
  for (const row of rows) {
    if (row.parentId === null) continue
    const path = paths.get(row.id) as string
    if (row.kind === 'doc') {
      result.push({
        path,
        id: row.id,
        kind: 'doc',
        text: texts.get(row.id) ?? '',
      })
    } else if (row.kind === 'file' && row.blobHash && row.gitOid) {
      result.push({
        path,
        id: row.id,
        kind: 'file',
        hash: row.blobHash,
        size: row.size,
        gitOid: row.gitOid,
      })
    } else if (row.kind === 'folder') {
      result.push({ path, id: row.id, kind: 'folder' })
    }
  }
  result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { rows, entries: result }
}
