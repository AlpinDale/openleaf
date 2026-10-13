// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  type Role,
  TRACK_CHANGES_ALL,
  YDOC_CHANGES,
  YDOC_TEXTS,
} from '@openleaf/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'
import {
  readChanges,
  type TrackedChange,
  trackChangesMap,
} from '@/features/review/changes'
import { dispatchEditorTransactions } from '@/features/review/dispatch-editor-transactions'
import { trackChangesCapture } from '@/features/review/extensions/track-changes'
import { rejectChanges } from '@/features/review/track-changes-actions'

const DOC_ID = 'doc-1'
const INITIAL = 'Hello world, this is a test document.'
const REMOTE = 'remote'

type Peer = {
  ydoc: Y.Doc
  ytext: Y.Text
  view: EditorView
  undo: Y.UndoManager
}

const views: EditorView[] = []

function createPeer(ydoc: Y.Doc, userId: string, role: Role = 'editor'): Peer {
  const ytext = ydoc.getMap<Y.Text>(YDOC_TEXTS).get(DOC_ID)
  if (!ytext) throw new Error('missing text')
  const undo = new Y.UndoManager([ytext, ydoc.getMap(YDOC_CHANGES)])
  const view: EditorView = new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        yCollab(ytext, null, { undoManager: undo }),
        trackChangesCapture({
          ydoc,
          ytext,
          docId: DOC_ID,
          userId,
          role,
        }),
      ],
    }),
    dispatchTransactions: transactions =>
      dispatchEditorTransactions(view, transactions),
    parent: document.body,
  })
  views.push(view)
  return { ydoc, ytext, view, undo }
}

/** Two docs that apply each other's updates, each with its own editor. */
function setup() {
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  docA.getMap<Y.Text>(YDOC_TEXTS).set(DOC_ID, new Y.Text(INITIAL))
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), REMOTE)
  docA.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(docB, update, REMOTE)
  })
  docB.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(docA, update, REMOTE)
  })
  trackChangesMap(docA).set('user-a', true)
  return { a: createPeer(docA, 'user-a'), b: createPeer(docB, 'user-b') }
}

/** Lets the capture plugin's microtask refresh of `trackedChangesField` run. */
const tick = () => Promise.resolve()

async function type(peer: Peer, at: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    peer.view.dispatch({
      changes: { from: at + i, insert: text[i] },
      userEvent: 'input.type',
    })
    await tick()
  }
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

describe('track changes capture', () => {
  it('does not delete another author’s collapsed insert record while reviewing', async () => {
    const doc = new Y.Doc()
    doc.getMap<Y.Text>(YDOC_TEXTS).set(DOC_ID, new Y.Text(INITIAL))
    trackChangesMap(doc).set('owner', true)
    const owner = createPeer(doc, 'owner')
    owner.view.dispatch({ changes: { from: 5, insert: 'abc' } })
    await tick()
    const [insert] = readChanges(doc, DOC_ID)
    const records = doc.getMap<Y.Map<unknown>>(YDOC_CHANGES)
    const ownerRecord = records.get(insert.id)
    const before = ownerRecord?.toJSON()
    const reviewer = createPeer(doc, 'reviewer', 'reviewer')
    await tick()
    reviewer.view.dispatch({ changes: { from: 5, to: 8 } })
    await tick()
    expect(records.get(insert.id)).toBe(ownerRecord)
    expect(ownerRecord?.toJSON()).toEqual(before)
    expect(readChanges(doc, DOC_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'delete',
          userId: 'reviewer',
          text: 'abc',
        }),
      ])
    )
  })

  it('sends reviewer text and tracking records atomically to another real editor', async () => {
    const local = new Y.Doc()
    const remote = new Y.Doc()
    local.getMap<Y.Text>(YDOC_TEXTS).set(DOC_ID, new Y.Text(INITIAL))
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local), REMOTE)
    const reviewer = createPeer(local, 'reviewer', 'reviewer')
    const observer = createPeer(remote, 'editor')
    await tick()
    const snapshots: { text: string; changes: TrackedChange[] }[] = []
    local.on('update', update => {
      Y.applyUpdate(remote, update, REMOTE)
      snapshots.push({
        text: observer.ytext.toString(),
        changes: readChanges(remote, DOC_ID),
      })
    })

    reviewer.view.dispatch({ changes: { from: 5, insert: 'abc' } })
    await tick()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      text: `Helloabc${INITIAL.slice(5)}`,
      changes: [{ type: 'insert', userId: 'reviewer', from: 5, to: 8 }],
    })
    expect(observer.view.state.doc.toString()).toBe(snapshots[0].text)
    expect(reviewer.view.state.doc.toString()).toBe(snapshots[0].text)

    reviewer.view.dispatch({ changes: { from: 7, to: 8 } })
    await tick()
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1]).toMatchObject({
      text: `Helloab${INITIAL.slice(5)}`,
      changes: [{ type: 'insert', userId: 'reviewer', from: 5, to: 7 }],
    })

    reviewer.undo.stopCapturing()
    reviewer.view.dispatch({ changes: { from: 7, to: 10 } })
    await tick()
    expect(snapshots).toHaveLength(3)
    expect(snapshots[2].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'delete',
          userId: 'reviewer',
          text: ' wo',
        }),
      ])
    )

    reviewer.undo.undo()
    await tick()
    expect(snapshots).toHaveLength(4)
    expect(snapshots[3]).toMatchObject({
      text: `Helloab${INITIAL.slice(5)}`,
      changes: [{ type: 'insert', userId: 'reviewer', from: 5, to: 7 }],
    })
    expect(reviewer.view.state.doc.toString()).toBe(
      observer.view.state.doc.toString()
    )
    reviewer.undo.redo()
    await tick()
    expect(snapshots).toHaveLength(5)
    expect(snapshots[4]).toEqual(snapshots[2])
  })

  it('tracks reviewer edits even without a personal or project flag', async () => {
    const ydoc = new Y.Doc()
    ydoc.getMap<Y.Text>(YDOC_TEXTS).set(DOC_ID, new Y.Text(INITIAL))
    const peer = createPeer(ydoc, 'reviewer', 'reviewer')
    await tick()
    await type(peer, 0, 'review')
    expect(readChanges(ydoc, DOC_ID)).toMatchObject([
      { type: 'insert', userId: 'reviewer', from: 0, to: 6 },
    ])
  })

  it('records, merges, undoes and rejects tracked changes', async () => {
    const { a, b } = setup()

    await type(a, 5, 'abc')
    let changes = readChanges(a.ydoc, DOC_ID)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      type: 'insert',
      userId: 'user-a',
      from: 5,
      to: 8,
    })

    // backspace the "c": the record shrinks, nothing is recorded as deleted
    a.view.dispatch({ changes: { from: 7, to: 8 }, userEvent: 'delete' })
    await tick()
    changes = readChanges(a.ydoc, DOC_ID)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ type: 'insert', from: 5, to: 7 })
    expect(a.ytext.toString()).toBe(`Helloab${INITIAL.slice(5)}`)

    // delete 3 pre-existing characters (" wo" after the insert)
    a.undo.stopCapturing()
    a.view.dispatch({ changes: { from: 7, to: 10 }, userEvent: 'delete' })
    await tick()
    const afterDelete = readChanges(a.ydoc, DOC_ID)
    const deletes = afterDelete.filter(change => change.type === 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toMatchObject({ text: ' wo', pos: 7 })

    // undo brings the text back and drops the delete record
    a.undo.stopCapturing()
    a.undo.undo()
    await tick()
    expect(a.ytext.toString()).toBe(`Helloab${INITIAL.slice(5)}`)
    expect(a.view.state.doc.toString()).toBe(a.ytext.toString())
    expect(
      readChanges(a.ydoc, DOC_ID).filter(change => change.type === 'delete')
    ).toHaveLength(0)

    // rejecting the insert removes its text from both docs
    const [insert] = readChanges(a.ydoc, DOC_ID)
    expect(insert.type).toBe('insert')
    rejectChanges(a.ydoc, [insert.id])
    await tick()
    expect(a.ytext.toString()).toBe(INITIAL)
    expect(b.ytext.toString()).toBe(INITIAL)
    expect(b.view.state.doc.toString()).toBe(INITIAL)
    expect(readChanges(b.ydoc, DOC_ID)).toHaveLength(0)

    // B isn't tracking: its edit creates no record on either side
    await type(b, 0, 'xyz')
    expect(a.ytext.toString()).toBe(`xyz${INITIAL}`)
    expect(a.view.state.doc.toString()).toBe(`xyz${INITIAL}`)
    expect(readChanges(a.ydoc, DOC_ID)).toHaveLength(0)
    expect(readChanges(b.ydoc, DOC_ID)).toHaveLength(0)
  })

  it('tracks everyone when the project-wide flag is set', async () => {
    const { a, b } = setup()
    trackChangesMap(a.ydoc).delete('user-a')
    trackChangesMap(b.ydoc).set(TRACK_CHANGES_ALL, true)
    await type(b, 0, 'hi')
    const changes = readChanges(a.ydoc, DOC_ID)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ userId: 'user-b', from: 0, to: 2 })
  })
})
