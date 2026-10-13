import { TRACK_CHANGES_ALL } from '@openleaf/shared'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { create } from 'zustand'
import { useCurrentMe } from '@/api/auth'
import { roleAtLeast, useIdeProject } from '@/features/ide-react/openleaf-ide'
import { useProjectSession } from '@/features/project/session-context'
import { changesMap, commentsMap, trackChangesMap } from './changes'

export type ReviewTab = 'current' | 'overview'
/** A comment being written for `[from, to)` of `docId`. */
export type CommentComposer = { docId: string; from: number; to: number }

export const useReviewStore = create<{
  tab: ReviewTab
  composer: CommentComposer | null
}>(() => ({ tab: 'current', composer: null }))

export type TrackChangesMode = 'off' | 'me' | 'all'

/** Writes the Y `trackChanges` flags for the header select. */
export function setTrackChangesMode(
  ydoc: Y.Doc,
  userId: string,
  mode: TrackChangesMode
) {
  const map = trackChangesMap(ydoc)
  ydoc.transact(() => {
    if (mode === 'all') map.set(TRACK_CHANGES_ALL, true)
    else map.delete(TRACK_CHANGES_ALL)
    if (mode === 'me') map.set(userId, true)
    else map.delete(userId)
  })
}

export function toggleTrackChangesForUser(ydoc: Y.Doc, userId: string) {
  const map = trackChangesMap(ydoc)
  if (map.get(userId) === true) map.delete(userId)
  else map.set(userId, true)
}

/**
 * A counter bumped by every change to the review-related Y data (records,
 * anchors, flags, and text, which moves anchors), for re-rendering.
 */
export function useReviewYVersion(): number {
  const { ydoc, texts } = useProjectSession()
  const version = useRef(0)
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        version.current++
        onChange()
      }
      const types = [
        changesMap(ydoc),
        commentsMap(ydoc),
        trackChangesMap(ydoc),
        texts,
      ]
      for (const type of types) type.observeDeep(handler)
      return () => {
        for (const type of types) type.unobserveDeep(handler)
      }
    },
    [ydoc, texts]
  )
  return useSyncExternalStore(subscribe, () => version.current)
}

/** Track changes state for the current user (plan M7 step 4). */
export function useTrackChangesState() {
  const { ydoc } = useProjectSession()
  const { role } = useIdeProject()
  const userId = useCurrentMe().user.id
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
  const mode: TrackChangesMode = all ? 'all' : mine ? 'me' : 'off'
  return {
    mode,
    /** Whether this user's edits are being tracked. */
    enabled: all || mine || role === 'reviewer',
    canManage: roleAtLeast(role, 'editor'),
  }
}
