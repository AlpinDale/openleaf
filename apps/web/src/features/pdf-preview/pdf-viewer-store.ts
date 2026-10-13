import { create } from 'zustand'
import type PDFJSWrapper from './util/pdf-js-wrapper'

export type ZoomOption =
  | 'zoom-in'
  | 'zoom-out'
  | 'page-width'
  | 'page-height'
  | string

type ViewerPosition = PDFJSWrapper['currentPosition']

type PdfViewerState = {
  wrapper: PDFJSWrapper | null
  projectId: string | null
  /** 1-based current page, once the document rendered. */
  page: number | null
  totalPages: number | null
  /** Numeric scale (1 = 100%). */
  rawScale: number | null
  /** pdf.js scale value: a number as string, or `page-width` / `page-height`. */
  scaleValue: string
  /** The viewer is full screen, one page at a time. */
  presentationMode: boolean
}

/** The mounted pdf.js viewer's state, shared with the PDF toolbar. */
export const usePdfViewerStore = create<PdfViewerState>(() => ({
  wrapper: null,
  projectId: null,
  page: null,
  totalPages: null,
  rawScale: null,
  scaleValue: 'page-width',
  presentationMode: false,
}))

/** Scroll position kept across builds and viewer remounts. */
let savedPosition: ViewerPosition | null = null
let savedPositionProjectId: string | null = null

export function savePosition() {
  const { wrapper, projectId } = usePdfViewerStore.getState()
  if (!wrapper?.viewer.pdfDocument) return
  try {
    savedPosition = wrapper.currentPosition
    savedPositionProjectId = projectId
  } catch {
    // no rendered page yet
  }
}

export function getSavedPosition() {
  return savedPositionProjectId === usePdfViewerStore.getState().projectId
    ? savedPosition
    : null
}

export function scaleStorageKey(projectId: string) {
  return `openleaf:pdf-scale:${projectId}`
}

export function setZoom(zoom: ZoomOption) {
  const { wrapper } = usePdfViewerStore.getState()
  let scaleValue = zoom
  if (zoom === 'zoom-in' || zoom === 'zoom-out') {
    if (!wrapper) return
    const current = wrapper.viewer.currentScale
    scaleValue = String(
      zoom === 'zoom-in'
        ? Math.min(current * 1.25, 9.99)
        : Math.max(current / 1.25, 0.1)
    )
  }
  usePdfViewerStore.setState({ scaleValue })
  if (wrapper) wrapper.viewer.currentScaleValue = scaleValue
}

export function setPage(page: number) {
  const { wrapper, totalPages } = usePdfViewerStore.getState()
  if (!wrapper || !totalPages || page < 1 || page > totalPages) return
  wrapper.viewer.currentPageNumber = page
  usePdfViewerStore.setState({ page })
}

/** Moves `delta` pages from the current one (no-op past either end). */
export function stepPage(delta: number) {
  const { page } = usePdfViewerStore.getState()
  if (page !== null) setPage(page + delta)
}

/**
 * Shows the PDF full screen, one page at a time (the viewer switches its
 * scroll mode when the `fullscreenchange` event fires).
 */
export function requestPresentationMode() {
  const { wrapper } = usePdfViewerStore.getState()
  wrapper?.container.parentElement?.requestFullscreen?.().catch(() => {})
}

/** PDF coordinates (1-based page, points from the top-left) of the viewport centre. */
export function viewportCenterPosition(): {
  page: number
  h: number
  v: number
} | null {
  const { wrapper } = usePdfViewerStore.getState()
  if (!wrapper?.viewer.pdfDocument) return null
  const containerRect = wrapper.container.getBoundingClientRect()
  const x = containerRect.left + containerRect.width / 2
  const y = containerRect.top + containerRect.height / 2
  const { pagesCount } = wrapper.viewer
  let best: { index: number; distance: number } | null = null
  for (let index = 0; index < pagesCount; index++) {
    const rect = wrapper.viewer.getPageView(index)?.div?.getBoundingClientRect()
    if (!rect) continue
    const distance =
      y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    if (!best || distance < best.distance) best = { index, distance }
    if (distance === 0) break
  }
  if (!best) return null
  const pageView = wrapper.viewer.getPageView(best.index)
  const rect = pageView.div.getBoundingClientRect()
  const dx = Math.min(Math.max(x - rect.left, 0), rect.width)
  const dy = Math.min(Math.max(y - rect.top, 0), rect.height)
  const [left, top] = pageView.viewport.convertToPdfPoint(dx, dy)
  return {
    page: best.index + 1,
    h: left,
    v: pageView.viewport.viewBox[3] - top,
  }
}
