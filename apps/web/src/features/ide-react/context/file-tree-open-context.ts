import { useCallback, useMemo } from 'react'
import { useEditorStore } from '@/features/editor/editor-store'
import { findInTree } from '@/features/file-tree/util/find-in-tree'
import { useFileTreeFolder } from '@/features/ide-react/openleaf-ide'

type OpenEntity = {
  type: 'doc' | 'fileRef'
  entity: { _id: string; name: string }
  /** Ids of the folders containing the entity, starting with the root. */
  path: string[]
}

export function useFileTreeOpenContext() {
  const openDocId = useEditorStore(s => s.openDocId)
  const openFileId = useEditorStore(s => s.openFileId)
  const folder = useFileTreeFolder()
  const openEntity = useMemo<OpenEntity | null>(() => {
    if (openFileId || !openDocId) return null
    const found = findInTree(folder, openDocId)
    if (found?.type !== 'doc') return null
    return { type: 'doc', entity: found.entity, path: found.path }
  }, [folder, openDocId, openFileId])
  const openDocWithId = useCallback(
    (id: string) => useEditorStore.getState().openDoc(id),
    []
  )
  return {
    openEntity,
    selectedEntityCount: openDocId || openFileId ? 1 : 0,
    openDocWithId,
  }
}
