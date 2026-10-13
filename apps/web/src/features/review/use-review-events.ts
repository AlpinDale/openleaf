import { useEffect } from 'react'
import { useCurrentMe } from '@/api/auth'
import { getEditorView, useEditorBridge } from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'
import { roleAtLeast, useIdeProject } from '@/features/ide-react/openleaf-ide'
import { useProjectSession } from '@/features/project/session-context'
import { ADD_COMMENT_EVENT } from './extensions/add-comment-tooltip'
import { setCommentDraftEffect } from './extensions/comment-highlights'
import { toggleTrackChangesForUser, useReviewStore } from './review-store'

/** Opens the review panel with a comment composer for the editor selection. */
function startComment() {
  const view = getEditorView()
  const { docId } = useEditorBridge.getState()
  if (!view || !docId) return
  let { from, to } = view.state.selection.main
  if (from === to) {
    const word = view.state.wordAt(from)
    if (!word) return
    from = word.from
    to = word.to
  }
  useReviewStore.setState({ composer: { docId, from, to }, tab: 'current' })
  useEditorStore.setState({ reviewOpen: true })
  view.dispatch({ effects: setCommentDraftEffect.of({ from, to }) })
}

/**
 * The review commands behind the editor shortcuts, toolbar, context menu and
 * selection tooltip, which all dispatch window events.
 */
export function useReviewEvents() {
  const { ydoc } = useProjectSession()
  const { role } = useIdeProject()
  const userId = useCurrentMe().user.id

  useEffect(() => {
    const toggleReview = () => useEditorStore.getState().toggleReview()
    const addComment = () => {
      if (roleAtLeast(role, 'reviewer')) startComment()
    }
    const toggleTracking = () => {
      if (roleAtLeast(role, 'editor')) toggleTrackChangesForUser(ydoc, userId)
    }
    window.addEventListener('ui.toggle-review-panel', toggleReview)
    window.addEventListener(ADD_COMMENT_EVENT, addComment)
    window.addEventListener('toggle-track-changes', toggleTracking)
    return () => {
      window.removeEventListener('ui.toggle-review-panel', toggleReview)
      window.removeEventListener(ADD_COMMENT_EVENT, addComment)
      window.removeEventListener('toggle-track-changes', toggleTracking)
    }
  }, [ydoc, role, userId])
}
