import type { TreeEntry } from '@openleaf/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/index.js'
import { entries } from '../db/schema.js'

export type EntryRow = typeof entries.$inferSelect

export function loadEntries(db: Db, projectId: string): EntryRow[] {
  return db.select().from(entries).where(eq(entries.projectId, projectId)).all()
}

export function rootOf(rows: EntryRow[]): EntryRow {
  const root = rows.find(r => r.parentId === null)
  if (!root) throw new Error('Project has no root folder')
  return root
}

/** Project-relative paths (`dir/file.tex`) for every entry; the root is ''. */
export function buildPaths(rows: EntryRow[]): Map<string, string> {
  const byId = new Map(rows.map(r => [r.id, r]))
  const paths = new Map<string, string>()
  const resolve = (row: EntryRow): string => {
    const cached = paths.get(row.id)
    if (cached !== undefined) return cached
    let path = ''
    if (row.parentId !== null) {
      const parent = byId.get(row.parentId)
      const parentPath = parent ? resolve(parent) : ''
      path = parentPath ? `${parentPath}/${row.name}` : row.name
    }
    paths.set(row.id, path)
    return path
  }
  for (const row of rows) resolve(row)
  return paths
}

/** The entry ids of `rootId` and all its descendants. */
export function subtreeIds(rows: EntryRow[], rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const r of rows) {
    if (r.parentId) {
      const list = children.get(r.parentId) ?? []
      list.push(r.id)
      children.set(r.parentId, list)
    }
  }
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as string
    if (ids.has(id)) throw new Error('File tree contains a cycle')
    ids.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return ids
}

/** Avoids SQLite's recursive foreign-key cascade limit on deep trees. */
export function deletionOrder(rows: EntryRow[]): string[] {
  const parents = new Map<string, string | null>()
  for (const row of rows) parents.set(row.id, row.parentId)
  const children = new Map<string, number>()
  for (const parentId of parents.values())
    if (parentId && parents.has(parentId))
      children.set(parentId, (children.get(parentId) ?? 0) + 1)
  const order: string[] = []
  for (const id of parents.keys()) if (!children.has(id)) order.push(id)
  for (let i = 0; i < order.length; i++) {
    const parentId = parents.get(order[i])
    if (!parentId || !parents.has(parentId)) continue
    const remaining = (children.get(parentId) as number) - 1
    children.set(parentId, remaining)
    if (remaining === 0) order.push(parentId)
  }
  if (order.length !== rows.length)
    throw new Error('File tree contains a cycle')
  return order
}

export function toTreeEntry(row: EntryRow): TreeEntry {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    name: row.name,
    size: row.size,
    updatedAt: row.updatedAt,
    sourceUrl: row.sourceUrl,
  }
}
