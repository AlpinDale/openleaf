import type { ProjectTree } from '@openleaf/shared'
import path from 'path-browserify'
import { queryClient } from '@/api/query-client'
import { treeKey } from '@/api/tree'
import { indexTree } from '@/features/file-tree/util/tree-index'
import type { ProjectSession } from '@/features/project/session'

/** Read access to the live project (tree + Yjs doc texts), in Overleaf's API shape. */
export class ProjectSnapshot {
  constructor(private readonly session: ProjectSession) {}

  private index() {
    const tree = queryClient.getQueryData<ProjectTree>(
      treeKey(this.session.projectId)
    )
    return tree ? indexTree(tree) : null
  }

  /** The snapshot reads live data, so there is nothing to refresh. */
  async refresh() {}

  getDocPaths(): string[] {
    const index = this.index()
    if (!index) return []
    const paths: string[] = []
    for (const [id, entry] of index.byId) {
      if (entry.kind === 'doc') paths.push(index.paths.get(id)!)
    }
    return paths
  }

  getDocContents(docPath: string): string | null {
    const entry = this.index()?.byPath.get(docPath)
    if (entry?.kind !== 'doc') return null
    return this.session.texts.get(entry.id)?.toString() ?? null
  }

  /**
   * LaTeX file resolution: `filePath` with each extension, relative to the
   * project root, then relative to `currentPath`.
   */
  locateFile(
    filePath: string,
    currentPath = '/',
    extensions = ['.tex', '.bib']
  ) {
    if (filePath.startsWith('/')) return null
    const index = this.index()
    if (!index) return null
    const basePaths = ['/']
    if (currentPath !== '/') basePaths.push(currentPath)
    for (const basePath of basePaths) {
      for (const extension of ['', ...extensions]) {
        const candidate = path
          .resolve(basePath, `${filePath}${extension}`)
          .substring(1)
        if (index.byPath.get(candidate)?.kind === 'doc') return candidate
      }
    }
    return null
  }
}

const snapshots = new WeakMap<ProjectSession, ProjectSnapshot>()

export function getProjectSnapshot(session: ProjectSession) {
  let snapshot = snapshots.get(session)
  if (!snapshot) {
    snapshot = new ProjectSnapshot(session)
    snapshots.set(session, snapshot)
  }
  return snapshot
}
