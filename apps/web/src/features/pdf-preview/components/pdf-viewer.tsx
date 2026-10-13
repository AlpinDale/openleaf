import { throttle } from 'lodash'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import { debugConsole } from '@/utils/debugging'
import { syncToCode, useCompileStore } from '../compile-store'
import useMouseWheelZoom from '../hooks/use-mouse-wheel-zoom'
import usePresentationMode from '../hooks/use-presentation-mode'
import {
  getSavedPosition,
  savePosition,
  scaleStorageKey,
  setZoom,
  usePdfViewerStore,
} from '../pdf-viewer-store'
import { buildHighlightElement } from '../util/highlights'
import PDFJSWrapper from '../util/pdf-js-wrapper'

type TextLayerRenderedEvent = {
  pageNumber: number
  source: { textLayer?: { div: HTMLDivElement }; textLayerDiv?: HTMLDivElement }
}

/** pdf.js viewer for the current build; keeps scale and scroll position across builds. */
export function PdfViewer({
  url,
  projectId,
}: {
  url: string
  projectId: string
}) {
  const { t } = useTranslation()
  const innerRef = useRef<HTMLDivElement>(null)
  const [wrapper, setWrapper] = useState<PDFJSWrapper | null>(null)
  const [error, setError] = useState(false)
  const highlights = useCompileStore(s => s.highlights)

  // create the viewer when the container is mounted
  useEffect(() => {
    const container = innerRef.current
    if (!container) return
    const created = new PDFJSWrapper(container)
    const storedScale = localStorage.getItem(scaleStorageKey(projectId))
    usePdfViewerStore.setState({
      wrapper: created,
      projectId,
      scaleValue: storedScale || 'page-width',
      page: null,
      totalPages: null,
      rawScale: null,
    })
    setWrapper(created)
    return () => {
      savePosition()
      created.destroy()
      usePdfViewerStore.setState({
        wrapper: null,
        page: null,
        totalPages: null,
      })
    }
  }, [projectId])

  // persist the chosen scale per project
  useEffect(
    () =>
      usePdfViewerStore.subscribe((state, previous) => {
        if (state.scaleValue !== previous.scaleValue) {
          localStorage.setItem(scaleStorageKey(projectId), state.scaleValue)
        }
      }),
    [projectId]
  )

  usePresentationMode(wrapper)
  useMouseWheelZoom(wrapper)

  // viewer events
  useEffect(() => {
    if (!wrapper) return
    const { eventBus } = wrapper
    const handlePagesinit = () => {
      const { scaleValue } = usePdfViewerStore.getState()
      const position = getSavedPosition()
      if (position && position.page < wrapper.viewer.pagesCount) {
        wrapper.scrollToPosition(position, scaleValue as never)
      } else {
        wrapper.viewer.currentScaleValue = scaleValue
      }
      usePdfViewerStore.setState({
        page: wrapper.viewer.currentPageNumber,
        totalPages: wrapper.viewer.pagesCount,
        rawScale: wrapper.viewer.currentScale,
      })
    }
    const handleScaleChanging = (event: { scale: number }) => {
      usePdfViewerStore.setState({ rawScale: event.scale })
    }
    const handlePageChanging = (event: { pageNumber: number }) => {
      usePdfViewerStore.setState({ page: event.pageNumber })
    }
    const handleTextlayerrendered = (event: TextLayerRenderedEvent) => {
      const textLayerDiv =
        event.source.textLayerDiv ?? event.source.textLayer?.div
      if (!textLayerDiv || textLayerDiv.dataset.listeningForDoubleClick) return
      textLayerDiv.dataset.listeningForDoubleClick = 'true'
      textLayerDiv.addEventListener('dblclick', (mouseEvent: MouseEvent) => {
        const canvas = textLayerDiv
          .closest('.page')
          ?.querySelector('canvas') as HTMLCanvasElement | null
        if (!canvas) return
        const position = wrapper.clickPosition(
          mouseEvent,
          canvas,
          event.pageNumber - 1
        )
        if (!position) return
        void syncToCode({
          page: position.page + 1,
          h: position.offset.left,
          v: position.offset.top,
        })
      })
    }
    eventBus.on('pagesinit', handlePagesinit)
    eventBus.on('scalechanging', handleScaleChanging)
    eventBus.on('pagechanging', handlePageChanging)
    eventBus.on('textlayerrendered', handleTextlayerrendered)
    return () => {
      eventBus.off('pagesinit', handlePagesinit)
      eventBus.off('scalechanging', handleScaleChanging)
      eventBus.off('pagechanging', handlePageChanging)
      eventBus.off('textlayerrendered', handleTextlayerrendered)
    }
  }, [wrapper])

  // load the PDF document for each build
  useEffect(() => {
    if (!wrapper) return
    let cancelled = false
    savePosition()
    setError(false)
    wrapper
      .loadDocument({ url })
      .then(doc => {
        if (!cancelled && doc) {
          usePdfViewerStore.setState({ totalPages: doc.numPages })
        }
      })
      .catch(err => {
        if (cancelled) return
        debugConsole.error(err)
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [wrapper, url])

  // remember the scroll position, for restoring it on the next build
  useEffect(() => {
    if (!wrapper) return
    const listener = throttle(savePosition, 500)
    wrapper.container.addEventListener('scroll', listener)
    return () => {
      listener.cancel()
      wrapper.container.removeEventListener('scroll', listener)
    }
  }, [wrapper])

  // keep fit-to-width/height scales correct when the panel resizes
  useEffect(() => {
    if (!wrapper) return
    const listener = throttle(() => wrapper.updateOnResize(), 250)
    const observer = new ResizeObserver(listener)
    observer.observe(wrapper.container)
    return () => {
      listener.cancel()
      observer.disconnect()
    }
  }, [wrapper])

  // draw SyncTeX highlight boxes, fading them out over 1.5 s
  useEffect(() => {
    if (!wrapper || highlights.boxes.length === 0) return
    const timers: number[] = []
    const elements: HTMLElement[] = []
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          const element = entry.target as HTMLElement
          // appear at once, then fade out over 1.5 s
          element.style.transition = 'none'
          element.style.opacity = '0.5'
          timers.push(
            window.setTimeout(() => {
              element.style.transition = 'opacity 1.5s'
              element.style.opacity = '0'
            }, 500)
          )
        }
      },
      { threshold: 1.0 }
    )
    for (const box of highlights.boxes) {
      try {
        const element = buildHighlightElement(box, wrapper.viewer)
        element.classList.add('synctex-highlight')
        elements.push(element)
        observer.observe(element)
      } catch {
        // ignore boxes on pages that aren't rendered
      }
    }
    const [first] = elements
    if (first) {
      timers.push(
        window.setTimeout(() => {
          first.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 100)
      )
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      for (const element of elements) element.remove()
      observer.disconnect()
    }
  }, [wrapper, highlights])

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    const zoom = {
      '+': 'zoom-in',
      '=': 'zoom-in',
      '-': 'zoom-out',
      '0': 'page-width',
      '9': 'page-height',
    }[event.key]
    if (!zoom) return
    event.preventDefault()
    setZoom(zoom)
  }

  return (
    <div
      className="pdfjs-viewer pdfjs-viewer-outer"
      role="application"
      aria-label={t('pdf')}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        ref={innerRef}
        className="pdfjs-viewer-inner"
        data-testid="pdfjs-viewer-inner"
      >
        <div className="pdfViewer" />
      </div>
      {error && (
        <div className="pdf-preview-messages">
          <Notification type="error" content={t('pdf_viewer_error')} />
        </div>
      )}
    </div>
  )
}
