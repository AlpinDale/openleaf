// Adapted from Overleaf services/web/frontend/js/features/pdf-preview/hooks/use-presentation-mode.ts (AGPL-3.0).
import { useEffect } from 'react'
import { setZoom, stepPage, usePdfViewerStore } from '../pdf-viewer-store'
import type PDFJSWrapper from '../util/pdf-js-wrapper'

const SCROLL_MODE_PAGE = 3
const SPREAD_MODE_NONE = 0

/**
 * While the viewer is full screen (see `requestPresentationMode`), shows one
 * page at a time fitted to the screen; arrow keys, space, clicks and the wheel
 * move between pages. Leaving full screen (Esc) restores the previous view.
 */
export default function usePresentationMode(wrapper: PDFJSWrapper | null) {
  const presentationMode = usePdfViewerStore(s => s.presentationMode)

  useEffect(() => {
    if (!wrapper) return
    let stored: {
      scrollMode: number
      spreadMode: number
      scaleValue: string
    } | null = null

    const onFullscreenChange = () => {
      const fullscreen =
        document.fullscreenElement === wrapper.container.parentElement
      if (fullscreen && !stored) {
        stored = {
          scrollMode: wrapper.viewer.scrollMode,
          spreadMode: wrapper.viewer.spreadMode,
          scaleValue: usePdfViewerStore.getState().scaleValue,
        }
        wrapper.viewer.scrollMode = SCROLL_MODE_PAGE
        wrapper.viewer.spreadMode = SPREAD_MODE_NONE
        setZoom('page-fit')
        void wrapper.fetchAllData()
        usePdfViewerStore.setState({ presentationMode: true })
      } else if (!fullscreen && stored) {
        wrapper.viewer.scrollMode = stored.scrollMode
        wrapper.viewer.spreadMode = stored.spreadMode
        setZoom(stored.scaleValue)
        stored = null
        usePdfViewerStore.setState({ presentationMode: false })
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      usePdfViewerStore.setState({ presentationMode: false })
    }
  }, [wrapper])

  useEffect(() => {
    if (!presentationMode) return
    let wheelLocked = false

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          event.preventDefault()
          stepPage(-1)
          break
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
          event.preventDefault()
          stepPage(1)
          break
        case ' ':
          event.preventDefault()
          stepPage(event.shiftKey ? -1 : 1)
          break
      }
    }
    const onClick = (event: MouseEvent) => {
      // links inside the PDF keep working
      if ((event.target as HTMLElement).closest('a')) return
      stepPage(event.shiftKey ? -1 : 1)
    }
    const onWheel = (event: WheelEvent) => {
      // ctrlKey: trackpad pinch
      if (wheelLocked || event.ctrlKey) return
      wheelLocked = true
      stepPage(event.deltaY > 0 ? 1 : -1)
      window.setTimeout(() => {
        wheelLocked = false
      }, 200)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', onClick)
    window.addEventListener('wheel', onWheel)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', onClick)
      window.removeEventListener('wheel', onWheel)
    }
  }, [presentationMode])
}
