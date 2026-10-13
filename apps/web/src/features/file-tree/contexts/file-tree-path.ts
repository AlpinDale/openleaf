import type { PreviewPath } from '@ol-types/preview-path'
import path from 'path-browserify'
import { useMemo } from 'react'
import { findInTree } from '@/features/file-tree/util/find-in-tree'
import { indexTree } from '@/features/file-tree/util/tree-index'
import {
  previewByPathIn,
  useFileTreeFolder,
  useIdeTree,
} from '@/features/ide-react/openleaf-ide'
import type { FileTreeFindResult } from '@/features/ide-react/types/file-tree'
import { useProjectSession } from '@/features/project/session-context'

export function useFileTreePathContext(): {
  pathInFolder: (id: string) => string | null
  findEntityByPath: (path: string) => FileTreeFindResult | null
  previewByPath: (path: string) => PreviewPath | null
  dirname: (id: string) => string | null
} {
  const { projectId } = useProjectSession()
  const tree = useIdeTree()
  const folder = useFileTreeFolder()
  return useMemo(() => {
    const index = indexTree(tree)
    return {
      pathInFolder: id => index.paths.get(id) ?? null,
      findEntityByPath: entityPath => {
        const entry = index.byPath.get(entityPath.replace(/^\/+/, ''))
        return entry ? findInTree(folder, entry.id) : null
      },
      previewByPath: entityPath => previewByPathIn(projectId, tree, entityPath),
      dirname: id => {
        const entityPath = index.paths.get(id)
        if (entityPath == null) return null
        const dir = path.dirname(entityPath)
        return dir === '.' ? '' : dir
      },
    }
  }, [projectId, tree, folder])
}
