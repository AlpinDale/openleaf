import type { EntryKind, TreeEntry } from '@openleaf/shared'
import type { TreeIndex } from './tree-index'

/** Id of the placeholder row shown while a new file or folder is being named. */
export const DRAFT_ID = '__openleaf_draft__'

export type DraftEntry = {
  parentId: string
  kind: 'doc' | 'folder'
  name: string
}

export type FileTreeNode = {
  id: string
  name: string
  kind: EntryKind
  /** `null` for the draft row. */
  entry: TreeEntry | null
  /** Folders only; leaves must not have it so react-arborist treats them as leaves. */
  children?: FileTreeNode[]
}

/** react-arborist data for the root folder's children, with the draft row inserted. */
export function buildTreeNodes(
  index: TreeIndex,
  draft: DraftEntry | null
): FileTreeNode[] {
  const build = (folderId: string): FileTreeNode[] => {
    const nodes: FileTreeNode[] = (index.children.get(folderId) ?? []).map(
      entry => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        entry,
        children: entry.kind === 'folder' ? build(entry.id) : undefined,
      })
    )
    if (draft?.parentId === folderId) {
      const node: FileTreeNode = {
        id: DRAFT_ID,
        name: draft.name,
        kind: draft.kind,
        entry: null,
        children: draft.kind === 'folder' ? [] : undefined,
      }
      // Folders are listed first, so a new folder goes after the last folder.
      const at =
        draft.kind === 'folder'
          ? nodes.findIndex(n => n.kind !== 'folder')
          : nodes.length
      nodes.splice(at === -1 ? nodes.length : at, 0, node)
    }
    return nodes
  }
  return build(index.rootFolderId)
}
