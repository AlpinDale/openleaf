import { useEditorStore } from '@/features/editor/editor-store'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useIdeTree } from '@/features/ide-react/openleaf-ide'

export function useEditorOpenDocContext() {
  const openDocId = useEditorStore(s => s.openDocId)
  const tree = useIdeTree()
  const entry = openDocId ? indexTree(tree).byId.get(openDocId) : undefined
  return {
    currentDocumentId: openDocId,
    openDocName: entry?.name ?? null,
  }
}
