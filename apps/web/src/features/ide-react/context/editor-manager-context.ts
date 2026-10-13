import { useCallback } from 'react'
import { goToPosition, waitForDoc } from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'

export type GotoOffsetOptions = { gotoOffset: number }

type OpenDocOptions = {
  gotoLine?: number
  gotoColumn?: number
  gotoOffset?: number
}

/** Opens a doc and optionally moves the cursor (1-based `gotoLine`). */
export async function openDocWithId(
  docId: string,
  options: OpenDocOptions = {}
) {
  if (options.gotoOffset != null) {
    const offset = options.gotoOffset
    await goToPosition({
      docId,
      line: 1,
      selection: { from: offset, to: offset },
    })
  } else if (options.gotoLine != null) {
    await goToPosition({
      docId,
      line: options.gotoLine,
      column: options.gotoColumn,
    })
  } else {
    useEditorStore.getState().openDoc(docId)
    await waitForDoc(docId)
  }
}

export function useEditorManagerContext() {
  return { openDocWithId: useCallback(openDocWithId, []) }
}
