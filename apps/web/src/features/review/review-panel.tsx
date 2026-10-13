import type { EditorView } from '@codemirror/view'
import type { CommentThread, ProjectMember } from '@openleaf/shared'
import classNames from 'classnames'
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useCurrentMe } from '@/api/auth'
import { ApiError } from '@/api/client'
import {
  addMessage,
  createThread,
  deleteMessage,
  deleteThread,
  editMessage,
  reopenThread,
  resolveThread,
  useThreads,
} from '@/api/threads'
import { goToPosition, useEditorBridge } from '@/features/editor/editor-bridge'
import { indexTree } from '@/features/file-tree/util/tree-index'
import {
  roleAtLeast,
  useIdeProject,
  useIdeTree,
} from '@/features/ide-react/openleaf-ide'
import { useProjectSession } from '@/features/project/session-context'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import AutoExpandingTextArea from '@/shared/components/auto-expanding-text-area'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLOverlay from '@/shared/components/ol/ol-overlay'
import OLPopover from '@/shared/components/ol/ol-popover'
import { getHueForUserId } from '@/shared/utils/colors'
import {
  addCommentAnchor,
  type CommentAnchor,
  changeFrom,
  changeTo,
  readChanges,
  readCommentAnchors,
  removeCommentAnchor,
  type TrackedChange,
} from './changes'
import {
  commentDraft,
  setCommentDraftEffect,
  setFocusedThreadEffect,
} from './extensions/comment-highlights'
import { setFocusedChangeEffect } from './extensions/track-changes'
import {
  setTrackChangesMode,
  type TrackChangesMode,
  useReviewStore,
  useReviewYVersion,
  useTrackChangesState,
} from './review-store'
import {
  acceptChanges,
  changeIds,
  rejectChanges,
} from './track-changes-actions'

const CARD_GAP = 8
const DEFAULT_CARD_HEIGHT = 80

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
})

function formatRelativeTime(ts: number) {
  const seconds = Math.round((ts - Date.now()) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
  ]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return relativeTimeFormat.format(value, unit)
    value = Math.round(value / size)
  }
  return relativeTimeFormat.format(value, 'year')
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function errorMessage(err: unknown) {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : String(err)
}

/** Runs a server call from a button, toasting its failure. */
function run(action: () => Promise<unknown>) {
  action().catch(err =>
    showToast({ type: 'error', content: errorMessage(err) })
  )
}

type Members = Map<string, ProjectMember>

function Author({
  userId,
  name,
  members,
}: {
  userId: string
  name?: string
  members: Members
}) {
  const { t } = useTranslation()
  return (
    <span
      className="ol-review-author"
      style={{ '--tc-hue': getHueForUserId(userId) } as React.CSSProperties}
    >
      {name ?? members.get(userId)?.name ?? t('unknown')}
    </span>
  )
}

type Entry =
  | {
      kind: 'change'
      id: string
      from: number
      to: number
      change: TrackedChange
    }
  | {
      kind: 'comment'
      id: string
      from: number
      to: number
      thread: CommentThread
    }
  | { kind: 'composer'; id: string; from: number; to: number }

const COMPOSER_ID = '__composer__'

/** Selects an entry's range in the editor. */
function selectRange(view: EditorView, from: number, to: number) {
  const length = view.state.doc.length
  view.dispatch({
    selection: { anchor: Math.min(from, length), head: Math.min(to, length) },
    scrollIntoView: true,
  })
  view.focus()
}

const isInteractive = (target: EventTarget) =>
  target instanceof Element &&
  target.closest('button, textarea, input, select, a') !== null

/**
 * The review panel (plan M7 step 8): a 300 px column inside the editor's
 * scroller, so its cards scroll with the text they annotate.
 */
export function ReviewPanel() {
  const view = useCodeMirrorViewContext()
  const [container] = useState(() => {
    const element = document.createElement('div')
    element.className = 'ol-review-panel'
    element.setAttribute('data-testid', 'review-panel')
    return element
  })
  useLayoutEffect(() => {
    view.scrollDOM.append(container)
    return () => container.remove()
  }, [view, container])
  return createPortal(<ReviewPanelContent view={view} />, container)
}

function ReviewPanelContent({ view }: { view: EditorView }) {
  const { t } = useTranslation()
  const session = useProjectSession()
  const project = useIdeProject()
  const me = useCurrentMe()
  const tab = useReviewStore(s => s.tab)
  const docId = useEditorBridge(s => s.docId)
  const threads = useThreads(session.projectId).data
  useReviewYVersion()

  const members = useMemo(
    () => new Map(project.members.map(member => [member.id, member])),
    [project.members]
  )
  const canEdit = roleAtLeast(project.role, 'editor')

  return (
    <div className="ol-review-panel-inner">
      <div className="ol-review-panel-header">
        <TrackChangesSelect />
        <div className="ol-review-panel-header-row">
          <div className="ol-review-tabs" role="tablist">
            {(['current', 'overview'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={classNames('ol-review-tab', {
                  active: tab === value,
                })}
                onClick={() => useReviewStore.setState({ tab: value })}
              >
                {t(value === 'current' ? 'current_file' : 'overview')}
              </button>
            ))}
          </div>
          <ResolvedComments threads={threads ?? []} members={members} />
        </div>
        {canEdit && (
          <BulkActions docId={tab === 'current' ? docId : undefined} />
        )}
      </div>
      {tab === 'current' ? (
        docId && (
          <CurrentFileEntries
            view={view}
            docId={docId}
            threads={threads ?? []}
            members={members}
            myId={me.user.id}
          />
        )
      ) : (
        <Overview threads={threads ?? []} members={members} />
      )}
    </div>
  )
}

function TrackChangesSelect() {
  const { t } = useTranslation()
  const { ydoc } = useProjectSession()
  const me = useCurrentMe()
  const { mode, enabled, canManage } = useTrackChangesState()
  const id = useId()
  return (
    <div className="ol-review-track-changes">
      <label htmlFor={id}>{t('track_changes')}</label>
      <OLFormSelect
        id={id}
        size="sm"
        value={mode}
        disabled={!canManage}
        aria-label={t('track_changes')}
        onChange={event =>
          setTrackChangesMode(
            ydoc,
            me.user.id,
            event.target.value as TrackChangesMode
          )
        }
      >
        <option value="off">
          {enabled && mode === 'off'
            ? t('track_changes_on_reviewer')
            : t('off')}
        </option>
        <option value="me">{t('track_changes_on_for_me')}</option>
        <option value="all">{t('track_changes_on_for_everyone')}</option>
      </OLFormSelect>
    </div>
  )
}

/** Accept all / Reject all for one doc, or for the project when `docId` is undefined. */
function BulkActions({ docId }: { docId: string | null | undefined }) {
  const { t } = useTranslation()
  const { ydoc } = useProjectSession()
  if (docId === null) return null
  const ids = changeIds(ydoc, docId)
  if (ids.length === 0) return null
  return (
    <div className="ol-review-bulk-actions">
      <OLButton
        size="sm"
        variant="secondary"
        leadingIcon="check"
        onClick={() => acceptChanges(ydoc, ids)}
      >
        {t('accept_all')}
      </OLButton>
      <OLButton
        size="sm"
        variant="secondary"
        leadingIcon="close"
        onClick={() => rejectChanges(ydoc, ids)}
      >
        {t('reject_all')}
      </OLButton>
    </div>
  )
}

function ResolvedComments({
  threads,
  members,
}: {
  threads: CommentThread[]
  members: Members
}) {
  const { t } = useTranslation()
  const { projectId } = useProjectSession()
  const project = useIdeProject()
  const me = useCurrentMe()
  const tree = useIdeTree()
  const [show, setShow] = useState(false)
  const target = useRef<HTMLButtonElement>(null)
  const resolved = threads.filter(thread => thread.resolvedAt !== null)
  const paths = indexTree(tree).paths
  return (
    <>
      <button
        ref={target}
        type="button"
        className="btn btn-sm btn-ghost ol-review-resolved-button"
        aria-label={t('resolved_comments')}
        title={t('resolved_comments')}
        onClick={() => setShow(value => !value)}
      >
        <MaterialIcon type="inbox" />
      </button>
      <OLOverlay
        show={show}
        target={target.current}
        placement="bottom-end"
        rootClose
        onHide={() => setShow(false)}
      >
        <OLPopover
          id="ol-review-resolved-popover"
          className="ol-review-resolved-popover"
          title={t('resolved_comments')}
        >
          {resolved.length === 0 && <p>{t('no_resolved_comments')}</p>}
          {resolved.map(thread => (
            <div
              key={thread.id}
              className="ol-review-resolved-thread"
              data-testid="resolved-thread"
            >
              <div className="ol-review-resolved-path">
                {paths.get(thread.docId) ?? ''}
              </div>
              {thread.messages.map(message => (
                <div key={message.id} className="ol-review-message">
                  <Author
                    userId={message.userId}
                    name={message.userName}
                    members={members}
                  />{' '}
                  <span className="ol-review-message-content">
                    {message.content}
                  </span>
                </div>
              ))}
              <div className="ol-review-resolved-by">
                {t('resolved_by_x', {
                  name: thread.resolvedByName ?? t('unknown'),
                })}
              </div>
              <div className="ol-review-card-actions">
                {roleAtLeast(project.role, 'reviewer') && (
                  <OLButton
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      run(() => reopenThread(projectId, thread.id))
                    }
                  >
                    {t('reopen')}
                  </OLButton>
                )}
                {roleAtLeast(project.role, 'reviewer') &&
                  (thread.createdBy === me.user.id ||
                    roleAtLeast(project.role, 'editor')) && (
                    <OLButton
                      size="sm"
                      variant="danger-ghost"
                      onClick={() =>
                        run(() => deleteThread(projectId, thread.id))
                      }
                    >
                      {t('delete')}
                    </OLButton>
                  )}
              </div>
            </div>
          ))}
        </OLPopover>
      </OLOverlay>
    </>
  )
}

/** Comment anchors of open threads, keyed by thread id. */
function openAnchors(
  anchors: CommentAnchor[],
  threads: CommentThread[]
): { anchor: CommentAnchor; thread: CommentThread }[] {
  const byId = new Map(threads.map(thread => [thread.id, thread]))
  const result: { anchor: CommentAnchor; thread: CommentThread }[] = []
  for (const anchor of anchors) {
    const thread = byId.get(anchor.id)
    if (thread && thread.resolvedAt === null) result.push({ anchor, thread })
  }
  return result
}

function CurrentFileEntries({
  view,
  docId,
  threads,
  members,
  myId,
}: {
  view: EditorView
  docId: string
  threads: CommentThread[]
  members: Members
  myId: string
}) {
  const { t } = useTranslation()
  const { ydoc } = useProjectSession()
  const state = useCodeMirrorStateContext()
  const composer = useReviewStore(s => s.composer)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [, setGeometryVersion] = useState(0)

  useEffect(() => {
    const onGeometry = () => setGeometryVersion(v => v + 1)
    window.addEventListener('editor:geometry-change', onGeometry)
    return () =>
      window.removeEventListener('editor:geometry-change', onGeometry)
  }, [])

  const length = state.doc.length
  const entries: Entry[] = []
  for (const change of readChanges(ydoc, docId)) {
    entries.push({
      kind: 'change',
      id: change.id,
      from: Math.min(changeFrom(change), length),
      to: Math.min(changeTo(change), length),
      change,
    })
  }
  for (const { anchor, thread } of openAnchors(
    readCommentAnchors(ydoc, docId),
    threads
  )) {
    entries.push({
      kind: 'comment',
      id: thread.id,
      from: Math.min(anchor.from, length),
      to: Math.min(anchor.to, length),
      thread,
    })
  }
  const draft = commentDraft(state)
  if (composer && composer.docId === docId) {
    const range = draft ?? composer
    entries.push({
      kind: 'composer',
      id: COMPOSER_ID,
      from: Math.min(range.from, length),
      to: Math.min(range.to, length),
    })
  }
  entries.sort((a, b) => a.from - b.from || a.to - b.to)

  const head = state.selection.main.head
  const focusedId = composer
    ? COMPOSER_ID
    : entries.find(entry => entry.from <= head && head <= entry.to)?.id

  // the focused entry's highlight switches to its `-focused` class
  const focusedKind = entries.find(entry => entry.id === focusedId)?.kind
  const focusedThreadId = focusedKind === 'comment' ? (focusedId ?? null) : null
  const focusedChangeId = focusedKind === 'change' ? (focusedId ?? null) : null
  useEffect(() => {
    view.dispatch({
      effects: [
        setFocusedThreadEffect.of(focusedThreadId),
        setFocusedChangeEffect.of(focusedChangeId),
      ],
    })
  }, [view, focusedThreadId, focusedChangeId])
  useEffect(
    () => () =>
      view.dispatch({
        effects: [
          setFocusedThreadEffect.of(null),
          setFocusedChangeEffect.of(null),
        ],
      }),
    [view]
  )

  // line-aligned layout: each card sits at its line unless the previous card is in the way
  let previousBottom = Number.NEGATIVE_INFINITY
  const tops = new Map<string, number>()
  for (const entry of entries) {
    const preferred = view.lineBlockAt(entry.from).top + offset
    const top = Math.max(preferred, previousBottom + CARD_GAP)
    tops.set(entry.id, top)
    previousBottom = top + (heights[entry.id] ?? DEFAULT_CARD_HEIGHT)
  }

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const nextOffset = view.documentTop - body.getBoundingClientRect().top
    if (Math.abs(nextOffset - offset) > 0.5) setOffset(nextOffset)
    const next: Record<string, number> = {}
    let changed = false
    for (const card of body.querySelectorAll<HTMLElement>('[data-entry-id]')) {
      const id = card.dataset.entryId!
      next[id] = card.offsetHeight
      if (heights[id] !== next[id]) changed = true
    }
    if (changed || Object.keys(next).length !== Object.keys(heights).length)
      setHeights(next)
  })

  const cardProps = (entry: Entry) => ({
    'data-entry-id': entry.id,
    className: classNames('ol-review-card', `ol-review-card-${entry.kind}`, {
      'ol-review-card-focused': entry.id === focusedId,
    }),
    style: { top: tops.get(entry.id) },
    onClick: (event: MouseEvent) => {
      if (!isInteractive(event.target)) selectRange(view, entry.from, entry.to)
    },
  })

  return (
    <div
      ref={bodyRef}
      className="ol-review-entries"
      style={{ minHeight: Math.max(previousBottom, 0) + CARD_GAP }}
    >
      {entries.length === 0 && (
        <p className="ol-review-empty">{t('no_comments_or_changes')}</p>
      )}
      {entries.map(entry => (
        <div key={entry.id} {...cardProps(entry)}>
          {entry.kind === 'change' ? (
            <ChangeCardBody
              change={entry.change}
              text={
                entry.change.type === 'insert'
                  ? state.sliceDoc(entry.from, entry.to)
                  : entry.change.text
              }
              members={members}
            />
          ) : entry.kind === 'comment' ? (
            <CommentCardBody
              thread={entry.thread}
              members={members}
              myId={myId}
            />
          ) : (
            <Composer view={view} docId={docId} />
          )}
        </div>
      ))}
    </div>
  )
}

function ChangeCardBody({
  change,
  text,
  members,
}: {
  change: TrackedChange
  text: string
  members: Members
}) {
  const { t } = useTranslation()
  const { ydoc } = useProjectSession()
  const { role } = useIdeProject()
  return (
    <>
      <div className="ol-review-card-header">
        <MaterialIcon
          type={change.type === 'insert' ? 'edit_note' : 'delete'}
          className="ol-review-card-icon"
        />
        <Author userId={change.userId} members={members} />
        <span className="ol-review-time">{formatRelativeTime(change.ts)}</span>
      </div>
      <div className="ol-review-change-text">
        {t(change.type === 'insert' ? 'added_x' : 'deleted_x', {
          text: truncate(text, 100),
        })}
      </div>
      {roleAtLeast(role, 'editor') && (
        <div className="ol-review-card-actions">
          <OLButton
            size="sm"
            variant="secondary"
            leadingIcon="check"
            onClick={() => acceptChanges(ydoc, [change.id])}
          >
            {t('accept')}
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            leadingIcon="close"
            onClick={() => rejectChanges(ydoc, [change.id])}
          >
            {t('reject')}
          </OLButton>
        </div>
      )}
    </>
  )
}

/** Enter submits, Shift+Enter inserts a newline. */
function submitOnEnter(submit: () => void) {
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      submit()
    }
  }
}

function CommentCardBody({
  thread,
  members,
  myId,
}: {
  thread: CommentThread
  members: Members
  myId: string
}) {
  const { t } = useTranslation()
  const { projectId } = useProjectSession()
  const { role } = useIdeProject()
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )
  const canReview = roleAtLeast(role, 'reviewer')

  const sendReply = () => {
    const content = reply.trim()
    if (!content) return
    setReply('')
    run(() => addMessage(projectId, thread.id, content))
  }
  const saveEdit = () => {
    if (!editing) return
    const content = editing.text.trim()
    setEditing(null)
    if (content)
      run(() => editMessage(projectId, thread.id, editing.id, content))
  }

  return (
    <>
      {thread.messages.map(message => (
        <div key={message.id} className="ol-review-message">
          <div className="ol-review-card-header">
            <Author
              userId={message.userId}
              name={message.userName}
              members={members}
            />
            <span className="ol-review-time">
              {formatRelativeTime(message.createdAt)}
            </span>
            {canReview &&
              message.userId === myId &&
              editing?.id !== message.id && (
                <span className="ol-review-message-actions">
                  <button
                    type="button"
                    className="btn btn-link btn-sm"
                    onClick={() =>
                      setEditing({ id: message.id, text: message.content })
                    }
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-link btn-sm"
                    onClick={() =>
                      run(() => deleteMessage(projectId, thread.id, message.id))
                    }
                  >
                    {t('delete')}
                  </button>
                </span>
              )}
          </div>
          {canReview && editing?.id === message.id ? (
            <AutoExpandingTextArea
              className="form-control form-control-sm"
              value={editing.text}
              autoFocus
              onChange={event =>
                setEditing({ id: message.id, text: event.target.value })
              }
              onKeyDown={event => {
                if (event.key === 'Escape') setEditing(null)
                else submitOnEnter(saveEdit)(event)
              }}
              onBlur={saveEdit}
            />
          ) : (
            <div className="ol-review-message-content">{message.content}</div>
          )}
        </div>
      ))}
      {canReview && (
        <>
          <AutoExpandingTextArea
            className="form-control form-control-sm ol-review-reply"
            placeholder={t('reply')}
            aria-label={t('reply')}
            value={reply}
            onChange={event => setReply(event.target.value)}
            onKeyDown={submitOnEnter(sendReply)}
          />
          <div className="ol-review-card-actions">
            <OLButton
              size="sm"
              variant="secondary"
              leadingIcon="check"
              onClick={() => run(() => resolveThread(projectId, thread.id))}
            >
              {t('resolve')}
            </OLButton>
            {(thread.createdBy === myId || roleAtLeast(role, 'editor')) && (
              <OLButton
                size="sm"
                variant="danger-ghost"
                leadingIcon="delete"
                aria-label={t('delete_comment_thread')}
                onClick={() => run(() => deleteThread(projectId, thread.id))}
              >
                {t('delete')}
              </OLButton>
            )}
          </div>
        </>
      )}
    </>
  )
}

function Composer({ view, docId }: { view: EditorView; docId: string }) {
  const { t } = useTranslation()
  const { ydoc, texts, projectId } = useProjectSession()
  const { role } = useIdeProject()
  const me = useCurrentMe()
  const [content, setContent] = useState('')

  const close = useCallback(() => {
    useReviewStore.setState({ composer: null })
    view.dispatch({ effects: setCommentDraftEffect.of(null) })
  }, [view])

  const submit = () => {
    const text = content.trim()
    const range = commentDraft(view.state) ?? useReviewStore.getState().composer
    const ytext = texts.get(docId)
    if (!roleAtLeast(role, 'reviewer') || !text || !range || !ytext) return
    const id = crypto.randomUUID()
    addCommentAnchor(ydoc, ytext, id, docId, range.from, range.to, me.user.id)
    close()
    createThread(projectId, { id, docId, content: text }).catch(err => {
      removeCommentAnchor(ydoc, id)
      showToast({
        type: 'error',
        content: t('comment_could_not_be_added', {
          message: errorMessage(err),
        }),
      })
    })
  }

  return (
    <div data-testid="comment-composer">
      <AutoExpandingTextArea
        className="form-control form-control-sm"
        placeholder={t('add_your_comment_here')}
        aria-label={t('add_comment')}
        value={content}
        autoFocus
        onChange={event => setContent(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') close()
          else submitOnEnter(submit)(event)
        }}
      />
      <div className="ol-review-card-actions">
        <OLButton size="sm" variant="secondary" onClick={close}>
          {t('cancel')}
        </OLButton>
        <OLButton
          size="sm"
          variant="primary"
          disabled={!content.trim() || !roleAtLeast(role, 'reviewer')}
          onClick={submit}
        >
          {t('comment')}
        </OLButton>
      </div>
    </div>
  )
}

/** Every doc's changes and open threads, grouped by path (plan M7 step 8). */
function Overview({
  threads,
  members,
}: {
  threads: CommentThread[]
  members: Members
}) {
  const { t } = useTranslation()
  const { ydoc, texts } = useProjectSession()
  const tree = useIdeTree()
  const { paths, byId } = indexTree(tree)
  const anchors = readCommentAnchors(ydoc)
  const groups: { docId: string; path: string; items: ReactNode[] }[] = []

  const docIds = [...paths.keys()]
    .filter(id => byId.get(id)?.kind === 'doc')
    .sort((a, b) => (paths.get(a) ?? '').localeCompare(paths.get(b) ?? ''))
  for (const docId of docIds) {
    const text = texts.get(docId)?.toString() ?? ''
    const items: { from: number; to: number; node: ReactNode }[] = []
    const open = (from: number, to: number) =>
      goToPosition({ docId, line: 1, selection: { from, to } })
    for (const change of readChanges(ydoc, docId)) {
      const from = changeFrom(change)
      const to = changeTo(change)
      const changeText =
        change.type === 'insert' ? text.slice(from, to) : change.text
      items.push({
        from,
        to,
        node: (
          <button
            key={change.id}
            type="button"
            className="ol-review-overview-item"
            onClick={() => open(from, to)}
          >
            <MaterialIcon
              type={change.type === 'insert' ? 'edit_note' : 'delete'}
            />
            <Author userId={change.userId} members={members} />{' '}
            {t(change.type === 'insert' ? 'added_x' : 'deleted_x', {
              text: truncate(changeText, 100),
            })}
          </button>
        ),
      })
    }
    for (const { anchor, thread } of openAnchors(
      anchors.filter(a => a.docId === docId),
      threads
    )) {
      const first = thread.messages[0]
      items.push({
        from: anchor.from,
        to: anchor.to,
        node: (
          <button
            key={thread.id}
            type="button"
            className="ol-review-overview-item"
            onClick={() => open(anchor.from, anchor.to)}
          >
            <MaterialIcon type="chat" />
            {first && (
              <Author
                userId={first.userId}
                name={first.userName}
                members={members}
              />
            )}{' '}
            {truncate(first?.content ?? '', 100)}
          </button>
        ),
      })
    }
    if (items.length === 0) continue
    items.sort((a, b) => a.from - b.from)
    groups.push({
      docId,
      path: paths.get(docId) ?? '',
      items: items.map(item => item.node),
    })
  }

  return (
    <div className="ol-review-overview" data-testid="review-overview">
      {groups.length === 0 && (
        <p className="ol-review-empty">{t('no_comments_or_changes')}</p>
      )}
      {groups.map(group => (
        <section key={group.docId} className="ol-review-overview-group">
          <h4 className="ol-review-overview-path">
            {group.path}{' '}
            <span className="ol-review-overview-count">
              ({group.items.length})
            </span>
          </h4>
          {group.items}
        </section>
      ))}
    </div>
  )
}
