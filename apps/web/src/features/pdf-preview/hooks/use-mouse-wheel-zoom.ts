// Adapted from Overleaf services/web/frontend/js/features/pdf-preview/hooks/use-mouse-wheel-zoom.ts (AGPL-3.0).
import { useEffect } from 'react'
import { usePdfViewerStore } from '../pdf-viewer-store'
import type PDFJSWrapper from '../util/pdf-js-wrapper'

// Works for both a mouse wheel and a trackpad pinch (which arrives as a wheel
// event with ctrlKey). Trackpads send many small deltas, a wheel fewer large
// ones; the divisor suits the trackpad and the maximum keeps a fast wheel from
// changing the scale drastically.
const MAX_SCALE_FACTOR = 1.2
const SCALE_FACTOR_DIVISOR = 20

/** Ctrl/⌘ + wheel zooms the PDF around the pointer. */
export default function useMouseWheelZoom(wrapper: PDFJSWrapper | null) {
  useEffect(() => {
    if (!wrapper) return
    let zooming = false
    // Only zoom when the modifier was held before scrolling started, so
    // pressing it while a scroll still has momentum doesn't zoom by accident.
    let scrolling = false
    let scrollingTimer: number | undefined

    const zoom = (event: WheelEvent) => {
      const factor = Math.min(
        1 + Math.abs(event.deltaY) / SCALE_FACTOR_DIVISOR,
        MAX_SCALE_FACTOR
      )
      const previousScale = wrapper.viewer.currentScale
      const approximate = event.deltaY < 0 ? factor : 1 / factor
      const newScale = Math.round(previousScale * approximate * 100) / 100
      const exact = newScale / previousScale

      wrapper.viewer.currentScale = newScale
      usePdfViewerStore.setState({ scaleValue: String(newScale) })

      // keep the point under the pointer in place
      const rect = wrapper.container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      wrapper.container.scrollBy({
        left: x * exact - x,
        top: y * exact - y,
        behavior: 'instant',
      })
    }

    const onWheel = (event: WheelEvent) => {
      if ((event.metaKey || event.ctrlKey) && !scrolling) {
        event.preventDefault()
        if (zooming) return
        zooming = true
        zoom(event)
        window.setTimeout(() => {
          zooming = false
        }, 5)
        return
      }
      scrolling = true
      window.clearTimeout(scrollingTimer)
      scrollingTimer = window.setTimeout(() => {
        scrolling = false
      }, 100)
    }

    wrapper.container.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.clearTimeout(scrollingTimer)
      wrapper.container.removeEventListener('wheel', onWheel)
    }
  }, [wrapper])
}
