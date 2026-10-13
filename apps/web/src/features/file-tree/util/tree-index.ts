import type { ProjectTree, TreeEntry } from '@openleaf/shared'

export type TreeIndex = {
  rootFolderId: string
  byId: Map<string, TreeEntry>
  /** Children per folder id, folders first, then by name. */
  children: Map<string, TreeEntry[]>
  /** Project-relative path per entry id (`''` for the root folder). */
  paths: Map<string, string>
  byPath: Map<string, TreeEntry>
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function compareEntries(a: TreeEntry, b: TreeEntry) {
  if ((a.kind === 'folder') !== (b.kind === 'folder')) {
    return a.kind === 'folder' ? -1 : 1
  }
  return collator.compare(a.name, b.name)
}

const cache = new WeakMap<ProjectTree, TreeIndex>()

/** Lookup tables for a tree snapshot; memoised per (immutable) query result. */
export function indexTree(tree: ProjectTree): TreeIndex {
  const cached = cache.get(tree)
  if (cached) return cached

  const byId = new Map<string, TreeEntry>()
  const children = new Map<string, TreeEntry[]>()
  for (const entry of tree.entries) {
    byId.set(entry.id, entry)
    if (entry.parentId === null) continue
    const siblings = children.get(entry.parentId)
    if (siblings) siblings.push(entry)
    else children.set(entry.parentId, [entry])
  }
  for (const list of children.values()) list.sort(compareEntries)

  const paths = new Map<string, string>([[tree.rootFolderId, '']])
  const byPath = new Map<string, TreeEntry>()
  const walk = (folderId: string, prefix: string) => {
    for (const child of children.get(folderId) ?? []) {
      const path = prefix ? `${prefix}/${child.name}` : child.name
      paths.set(child.id, path)
      byPath.set(path, child)
      if (child.kind === 'folder') walk(child.id, path)
    }
  }
  walk(tree.rootFolderId, '')

  const index = {
    rootFolderId: tree.rootFolderId,
    byId,
    children,
    paths,
    byPath,
  }
  cache.set(tree, index)
  return index
}

/** True when `entryId` is `ancestorId` or lies inside it. */
export function isWithin(
  index: TreeIndex,
  entryId: string,
  ancestorId: string
) {
  let current: string | null | undefined = entryId
  while (current) {
    if (current === ancestorId) return true
    current = index.byId.get(current)?.parentId
  }
  return false
}
