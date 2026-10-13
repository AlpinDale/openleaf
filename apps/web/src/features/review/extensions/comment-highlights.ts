import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import type * as Y from 'yjs'
import { commentsMap, readCommentAnchors } from '../changes'

/** Ids of the unresolved threads that have a DB row (from the threads query). */
export const setOpenThreadsEffect = StateEffect.define<ReadonlySet<string>>()
/** The thread whose card is focused in the review panel, if any. */
export const setFocusedThreadEffect = StateEffect.define<string | null>()
/** Range of a comment being composed, highlighted until it's submitted. */
export const setCommentDraftEffect = StateEffect.define<{
  from: number
  to: number
} | null>()

const setCommentDecorationsEffect = StateEffect.define<DecorationSet>()

type CommentConfig = {
  openThreads: ReadonlySet<string>
  focused: string | null
  draft: { from: number; to: number } | null
}

const commentConfigField = StateField.define<CommentConfig>({
  create: () => ({ openThreads: new Set(), focused: null, draft: null }),
  update(value, tr) {
    let next = value
    if (next.draft && tr.docChanged) {
      next = {
        ...next,
        draft: {
          from: tr.changes.mapPos(next.draft.from, 1),
          to: tr.changes.mapPos(next.draft.to, -1),
        },
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(setOpenThreadsEffect))
        next = { ...next, openThreads: effect.value }
      else if (effect.is(setFocusedThreadEffect))
        next = { ...next, focused: effect.value }
      else if (effect.is(setCommentDraftEffect))
        next = { ...next, draft: effect.value }
    }
    return next
  },
})

/** The composer's range, mapped through edits made while writing. */
export const commentDraft = (state: EditorState) =>
  state.field(commentConfigField, false)?.draft ?? null

export const commentDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCommentDecorationsEffect)) return effect.value
    }
    return value.map(tr.changes)
  },
  provide: field => EditorView.decorations.from(field),
})

class DetachedCommentWidget extends WidgetType {
  constructor(readonly focused: boolean) {
    super()
  }

  eq(other: DetachedCommentWidget) {
    return other.focused === this.focused
  }

  toDOM() {
    const marker = document.createElement('span')
    marker.className = this.focused
      ? 'ol-comment-marker ol-comment-marker-focused'
      : 'ol-comment-marker'
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }
}

function buildDecorations(
  ydoc: Y.Doc,
  docId: string,
  config: CommentConfig,
  length: number
): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const anchor of readCommentAnchors(ydoc, docId)) {
    if (!config.openThreads.has(anchor.id)) continue
    const focused = anchor.id === config.focused
    const from = Math.min(anchor.from, length)
    const to = Math.min(anchor.to, length)
    if (to > from) {
      ranges.push(
        Decoration.mark({
          class: focused ? 'ol-comment ol-comment-focused' : 'ol-comment',
          attributes: { 'data-thread-id': anchor.id },
        }).range(from, to)
      )
    } else {
      ranges.push(
        Decoration.widget({
          widget: new DetachedCommentWidget(focused),
          side: 1,
        }).range(from)
      )
    }
  }
  if (config.draft && config.draft.to > config.draft.from) {
    ranges.push(
      Decoration.mark({ class: 'ol-comment ol-comment-focused' }).range(
        Math.min(config.draft.from, length),
        Math.min(config.draft.to, length)
      )
    )
  }
  return Decoration.set(ranges, true)
}

/** Highlights the open comment threads anchored in `docId` (plan M7 step 3). */
export function commentHighlights(ydoc: Y.Doc, docId: string): Extension {
  const plugin = ViewPlugin.define(view => {
    let scheduled = false
    let destroyed = false
    const recompute = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (destroyed) return
        view.dispatch({
          effects: setCommentDecorationsEffect.of(
            buildDecorations(
              ydoc,
              docId,
              view.state.field(commentConfigField),
              view.state.doc.length
            )
          ),
        })
      })
    }
    const comments = commentsMap(ydoc)
    comments.observeDeep(recompute)
    recompute()
    return {
      update(u) {
        if (
          u.docChanged ||
          u.startState.field(commentConfigField) !==
            u.state.field(commentConfigField)
        )
          recompute()
      },
      destroy() {
        destroyed = true
        comments.unobserveDeep(recompute)
      },
    }
  })
  return [commentConfigField, commentDecorationsField, plugin]
}
