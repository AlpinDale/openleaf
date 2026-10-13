import { afterEach, expect, it } from 'vitest'
import type PDFJSWrapper from '@/features/pdf-preview/util/pdf-js-wrapper'
import {
  getSavedPosition,
  savePosition,
  usePdfViewerStore,
} from '@/features/pdf-preview/pdf-viewer-store'

afterEach(() => usePdfViewerStore.setState({ wrapper: null, projectId: null }))

it('restores scroll within the same project but not across projects', () => {
  const position = { page: 3, offset: { left: 0, top: 100 } }
  const wrapper = {
    viewer: { pdfDocument: {} },
    currentPosition: position,
  } as unknown as PDFJSWrapper
  usePdfViewerStore.setState({ wrapper, projectId: 'first' })
  savePosition()
  expect(getSavedPosition()).toBe(position)
  usePdfViewerStore.setState({ wrapper: null, projectId: 'second' })
  expect(getSavedPosition()).toBeNull()
  usePdfViewerStore.setState({ projectId: 'first' })
  expect(getSavedPosition()).toBe(position)
})
