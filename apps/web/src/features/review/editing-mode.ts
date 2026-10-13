import { type Role, TRACK_CHANGES_ALL } from '@openleaf/shared'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { create } from 'zustand'
import { useCurrentMe } from '@/api/auth'
import { useIdeProject } from '@/features/ide-react/openleaf-ide'
import { useProjectSession } from '@/features/project/session-context'
import { trackChangesMap } from './changes'

/**
 * Overleaf's review-mode switcher. Editing: edits apply directly. Reviewing:
 * track changes on for me (`trackChanges[myId]`). Viewing: read-only for me,
 * local to this browser tab.
 */
export type EditingMode = 'editing' | 'reviewing' | 'viewing'

/** The modes a role may pick: viewers only view, reviewers can't edit directly. */
export function availableEditingModes(role: Role): EditingMode[] {
  if (role === 'viewer') return ['viewing']
  if (role === 'reviewer') return ['reviewing', 'viewing']
  return ['editing', 'reviewing', 'viewing']
}

type Binding = { ydoc: Y.Doc; userId: string; role: Role }

const useEditingModeStore = create<{
  /** Local read-only switch ("Viewing"). */
  viewing: boolean
  binding: Binding | null
}>(() => ({ viewing: false, binding: null }))

/**
 * Connects `setEditingMode` to the open project; rendered once by the editor
 * page. Leaving the project resets the local Viewing switch.
 */
export function EditingModeBinding() {
  const { ydoc } = useProjectSession()
  const { role } = useIdeProject()
  const userId = useCurrentMe().user.id
  useEffect(() => {
    useEditingModeStore.setState({ binding: { ydoc, userId, role } })
  }, [ydoc, userId, role])
  // a new project remounts this component
  useEffect(
    () => () => useEditingModeStore.setState({ viewing: false, binding: null }),
    []
  )
  return null
}

export function setEditingMode(mode: EditingMode) {
  const { binding } = useEditingModeStore.getState()
  if (!binding) return
  const { ydoc, userId, role } = binding
  if (!availableEditingModes(role).includes(mode)) return
  if (mode === 'viewing') {
    useEditingModeStore.setState({ viewing: true })
    return
  }
  const map = trackChangesMap(ydoc)
  // Editing for one user while tracking is on for everyone isn't possible
  if (mode === 'editing' && map.get(TRACK_CHANGES_ALL) === true) return
  if (mode === 'reviewing') {
    if (role !== 'reviewer' && map.get(userId) !== true) map.set(userId, true)
  } else if (map.has(userId)) {
    map.delete(userId)
  }
  useEditingModeStore.setState({ viewing: false })
}

/** Whether the local Viewing switch makes the editor read-only. */
export function useLocalViewing(): boolean {
  return useEditingModeStore(s => s.viewing)
}

export function useEditingMode(): {
  mode: EditingMode
  availableModes: EditingMode[]
  /** Available but not selectable right now (Editing while tracking is on for everyone). */
  disabledModes: EditingMode[]
} {
  const { ydoc } = useProjectSession()
  const { role } = useIdeProject()
  const userId = useCurrentMe().user.id
  const viewing = useEditingModeStore(s => s.viewing)
  const map = trackChangesMap(ydoc)
  const subscribe = useCallback(
    (onChange: () => void) => {
      map.observe(onChange)
      return () => map.unobserve(onChange)
    },
    [map]
  )
  const all = useSyncExternalStore(
    subscribe,
    () => map.get(TRACK_CHANGES_ALL) === true
  )
  const mine = useSyncExternalStore(subscribe, () => map.get(userId) === true)
  const availableModes = availableEditingModes(role)
  const mode: EditingMode =
    role === 'viewer' || viewing
      ? 'viewing'
      : all || mine || role === 'reviewer'
        ? 'reviewing'
        : 'editing'
  return {
    mode,
    availableModes,
    disabledModes: all && availableModes.includes('editing') ? ['editing'] : [],
  }
}
