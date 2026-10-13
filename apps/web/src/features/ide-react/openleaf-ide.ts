import type { Folder } from '@ol-types/folder'
import type { PreviewPath } from '@ol-types/preview-path'
import {
  DEFAULT_USER_SETTINGS,
  type ProjectDetails,
  type ProjectTree,
  type Role,
  type UserSettings,
} from '@openleaf/shared'
import { useMemo } from 'react'
import { useMe } from '@/api/auth'
import { useProject } from '@/api/projects'
import { fileUrl, useTree } from '@/api/tree'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useProjectSession } from '@/features/project/session-context'

/**
 * Data the ported Overleaf context shims read. Every hook here must be used
 * below the editor page, which has already loaded the project and the tree.
 */

export function useIdeProject(): ProjectDetails {
  const { projectId } = useProjectSession()
  const { data } = useProject(projectId)
  if (!data) throw new Error('Project used before it was loaded')
  return data
}

export function useIdeTree(): ProjectTree {
  const { projectId } = useProjectSession()
  const { data } = useTree(projectId)
  if (!data) throw new Error('Tree used before it was loaded')
  return data
}

export function useIdeUserSettings(): UserSettings {
  return useMe().data?.settings ?? DEFAULT_USER_SETTINGS
}

const ROLE_ORDER: Role[] = ['viewer', 'reviewer', 'editor', 'owner']

export function roleAtLeast(role: Role, min: Role) {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min)
}

/** Overleaf's nested `Folder` shape built from the flat tree. */
export function buildFolder(tree: ProjectTree): Folder {
  const index = indexTree(tree)
  const build = (id: string, name: string): Folder => {
    const folder: Folder = {
      _id: id,
      name,
      docs: [],
      folders: [],
      fileRefs: [],
    }
    for (const child of index.children.get(id) ?? []) {
      if (child.kind === 'folder')
        folder.folders.push(build(child.id, child.name))
      else if (child.kind === 'doc')
        folder.docs.push({ _id: child.id, name: child.name })
      else
        folder.fileRefs.push({
          _id: child.id,
          name: child.name,
          linkedFileData: child.sourceUrl
            ? { provider: 'url', url: child.sourceUrl }
            : undefined,
        })
    }
    return folder
  }
  return build(tree.rootFolderId, 'rootFolder')
}

const folderCache = new WeakMap<ProjectTree, Folder>()

export function useFileTreeFolder(): Folder {
  const tree = useIdeTree()
  return useMemo(() => {
    let folder = folderCache.get(tree)
    if (!folder) {
      folder = buildFolder(tree)
      folderCache.set(tree, folder)
    }
    return folder
  }, [tree])
}

export function previewByPathIn(
  projectId: string,
  tree: ProjectTree,
  path: string
): PreviewPath | null {
  const entry = indexTree(tree).byPath.get(path.replace(/^\/+/, ''))
  if (entry?.kind !== 'file') return null
  const dot = entry.name.lastIndexOf('.')
  return {
    url: fileUrl(projectId, entry.id),
    extension: dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '',
  }
}
