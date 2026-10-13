import { create } from 'zustand'
import { useEditorStore } from '@/features/editor/editor-store'

export type FileTreeAction = 'new-file' | 'new-folder' | 'upload'

/**
 * A pending file-tree action requested from outside the tree (the top-bar
 * File menu). The file tree panel performs it once it's mounted and sized.
 */
export const useFileTreeActions = create<{ request: FileTreeAction | null }>(
  () => ({ request: null })
)

/** Opens the Files rail tab and asks the file tree to run `action`. */
export function requestFileTreeAction(action: FileTreeAction) {
  useEditorStore.setState({ railTab: 'files' })
  useFileTreeActions.setState({ request: action })
}
