import { YDOC_TEXTS } from '@openleaf/shared'
import { expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addCommentAnchor,
  commentsMap,
  readCommentAnchors,
} from '@/features/review/changes'

it('includes the authenticated author in a new comment anchor before its thread exists', () => {
  const doc = new Y.Doc()
  const text = new Y.Text('commented text')
  doc.getMap<Y.Text>(YDOC_TEXTS).set('doc', text)
  addCommentAnchor(doc, text, 'thread', 'doc', 0, 9, 'reviewer')
  expect(commentsMap(doc).get('thread')?.get('userId')).toBe('reviewer')
  expect(readCommentAnchors(doc)).toEqual([
    { id: 'thread', docId: 'doc', from: 0, to: 9 },
  ])
  doc.destroy()
})
