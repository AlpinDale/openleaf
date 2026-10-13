import { useEffect, useMemo } from 'react'
import { useThreads } from '@/api/threads'
import { useEditorBridge } from '@/features/editor/editor-bridge'
import { roleAtLeast, useIdeProject } from '@/features/ide-react/openleaf-ide'
import { useProjectSession } from '@/features/project/session-context'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useTranslation } from '@/i18n'
import OLButton from '@/shared/components/ol/ol-button'
import { setOpenThreadsEffect } from './extensions/comment-highlights'
import { useReviewYVersion, useTrackChangesState } from './review-store'
import {
  acceptChanges,
  changeIdsInRange,
  rejectChanges,
} from './track-changes-actions'

/** Feeds the open threads from the threads query to the comment highlights. */
export function useCommentHighlightSync() {
  const view = useCodeMirrorViewContext()
  const { projectId } = useProjectSession()
  const docId = useEditorBridge(s => s.docId)
  const threads = useThreads(projectId).data
  const openThreads = useMemo(
    () =>
      new Set(
        (threads ?? [])
          .filter(thread => thread.resolvedAt === null)
          .map(thread => thread.id)
      ),
    [threads]
  )
  // re-sent when another doc's state is installed in the view
  // biome-ignore lint/correctness/useExhaustiveDependencies: docId marks a state switch
  useEffect(() => {
    view.dispatch({ effects: setOpenThreadsEffect.of(openThreads) })
  }, [view, openThreads, docId])
}

/** Toolbar: the "Track changes is on" badge and accept/reject for the selection. */
export function ReviewToolbarItems() {
  const { t } = useTranslation()
  const state = useCodeMirrorStateContext()
  const { ydoc } = useProjectSession()
  const { role } = useIdeProject()
  const docId = useEditorBridge(s => s.docId)
  const { enabled } = useTrackChangesState()
  useReviewYVersion()

  const { from, to, empty } = state.selection.main
  const selected =
    docId && !empty && roleAtLeast(role, 'editor')
      ? changeIdsInRange(ydoc, docId, from, to)
      : []

  return (
    <>
      {selected.length > 0 && (
        <>
          <OLButton
            size="sm"
            variant="ghost"
            leadingIcon="check"
            onClick={() => acceptChanges(ydoc, selected)}
          >
            {t('accept_selected_changes')}
          </OLButton>
          <OLButton
            size="sm"
            variant="ghost"
            leadingIcon="close"
            onClick={() => rejectChanges(ydoc, selected)}
          >
            {t('reject_selected_changes')}
          </OLButton>
        </>
      )}
      {enabled && (
        <span
          className="badge ol-track-changes-badge"
          data-testid="track-changes-badge"
        >
          {t('track_changes_is_on')}
        </span>
      )}
    </>
  )
}
