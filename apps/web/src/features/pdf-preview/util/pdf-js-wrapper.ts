import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import { captureException } from '@/infrastructure/error-reporter'
import { PDFJS, loadPdfDocumentFromUrl, imageResourcesPath } from './pdf-js'
import {
  PDFViewer,
  EventBus,
  PDFLinkService,
  LinkTarget,
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import browser from '@/features/source-editor/extensions/browser'

const DEFAULT_RANGE_CHUNK_SIZE = 128 * 1024 // 128K chunks

export default class PDFJSWrapper {
  public readonly viewer: PDFViewer
  public readonly eventBus: EventBus
  private readonly linkService: PDFLinkService
  private loadingTask?: PDFDocumentLoadingTask
  private documentTask?: PDFDocumentLoadingTask
  private destroyed = false

  // eslint-disable-next-line no-useless-constructor
  constructor(public container: HTMLDivElement) {
    // create the event bus
    this.eventBus = new EventBus()

    // create the link service
    this.linkService = new PDFLinkService({
      eventBus: this.eventBus,
      externalLinkTarget: LinkTarget.BLANK,
      externalLinkRel: 'noopener',
    })

    // create the viewer
    this.viewer = new PDFViewer({
      container: this.container,
      eventBus: this.eventBus,
      imageResourcesPath,
      linkService: this.linkService,
      maxCanvasPixels: browser.safari ? 4096 * 4096 : 8192 * 8192, // default is 4096 * 4096, increased for better resolution at high zoom levels (but not in Safari, which struggles with large canvases)
      annotationMode: PDFJS.AnnotationMode.ENABLE, // enable annotations but not forms
      annotationEditorMode: PDFJS.AnnotationEditorType.DISABLE, // disable annotation editing
    })

    this.linkService.setViewer(this.viewer)
  }

  // load a document from a URL
  async loadDocument({ url }: { url: string }) {
    if (this.destroyed) return
    const previous = this.loadingTask
    const task = loadPdfDocumentFromUrl(url, {
      rangeChunkSize: DEFAULT_RANGE_CHUNK_SIZE,
    })
    this.loadingTask = task
    if (previous && previous !== this.documentTask) {
      void previous.destroy().catch(captureException)
    }

    try {
      const doc = await task.promise

      // Task identity also isolates consecutive loads of the same URL.
      if (this.destroyed || this.loadingTask !== task) return

      // Hold the .pdfViewer element's height steady across the synchronous page-clear
      // that setDocument() triggers, so the viewer doesn't visually collapse while the
      // new pages are being initialised. The min-height is released on pagesinit.
      const viewerEl = this.container.querySelector('.pdfViewer') as HTMLElement
      const currentHeight = viewerEl.getBoundingClientRect().height
      if (currentHeight > 0) {
        viewerEl.style.minHeight = `${currentHeight}px`
        const clearMinHeight = () => {
          viewerEl.style.minHeight = ''
          this.eventBus.off('pagesinit', clearMinHeight)
        }
        this.eventBus.on('pagesinit', clearMinHeight)
      }

      const setDocument = () => {
        if (this.destroyed || this.loadingTask !== task) return
        const previousDocument = this.documentTask
        this.documentTask = task
        this.viewer.setDocument(doc)
        this.linkService.setDocument(doc)
        if (previousDocument && previousDocument !== task) {
          void previousDocument.destroy().catch(captureException)
        }
      }

      const container = this.container as typeof this.container & {
        // supported since Chrome 147
        startViewTransition?: (cb: () => void | Promise<void>) => {
          ready: Promise<void>
        }
      }

      if (
        typeof container.startViewTransition === 'function' &&
        document.visibilityState !== 'hidden'
      ) {
        const transition = container.startViewTransition(setDocument)

        transition.ready.catch(err => {
          const ignored = [
            'InvalidStateError', // the document was hidden, or the viewport was resized
            'AbortError', // another transition started
            'TimeoutError', // setDocument blocked for too long
          ]

          if (!ignored.includes(err?.name)) {
            captureException(err, {
              tags: { handler: 'pdf-preview' },
            })
          }
        })
      } else {
        setDocument()
      }

      return doc
    } catch (error: any) {
      if (this.destroyed || this.loadingTask !== task) return
      if (
        !error ||
        !(error instanceof PDFJS.ResponseException && error.missing === true)
      ) {
        captureException(error, {
          tags: { handler: 'pdf-preview' },
        })
      }

      throw error
    }
  }

  destroy() {
    this.destroyed = true
    this.viewer.setDocument(null as never)
    this.linkService.setDocument(null as never)
    const task = this.loadingTask
    const documentTask = this.documentTask
    this.documentTask = undefined
    this.loadingTask = undefined
    if (task) void task.destroy().catch(captureException)
    if (documentTask && documentTask !== task) {
      void documentTask.destroy().catch(captureException)
    }
  }

  async fetchAllData() {
    await this.viewer.pdfDocument?.getData()
  }

  // update the current scale value if the container size changes
  updateOnResize() {
    if (!this.isVisible()) {
      return
    }

    // Use requestAnimationFrame to prevent errors like "ResizeObserver loop
    // completed with undelivered notifications" that can occur if updating the
    // viewer causes another repaint. The cost of this is that the viewer update
    // lags one frame behind, but it's unlikely to matter.
    // Further reading: https://github.com/WICG/resize-observer/issues/38
    window.requestAnimationFrame(() => {
      if (this.destroyed) return
      const currentScaleValue = this.viewer.currentScaleValue

      if (
        currentScaleValue === 'auto' ||
        currentScaleValue === 'page-fit' ||
        currentScaleValue === 'page-height' ||
        currentScaleValue === 'page-width'
      ) {
        this.viewer.currentScaleValue = currentScaleValue
      }

      this.viewer.update()
    })
  }

  // get the page and offset of a click event
  clickPosition(event: MouseEvent, canvas: HTMLCanvasElement, page: number) {
    if (!canvas) {
      return
    }

    const { viewport } = this.viewer.getPageView(page)

    const pageRect = canvas.getBoundingClientRect()

    const dx = event.clientX - pageRect.left
    const dy = event.clientY - pageRect.top

    const [left, top] = viewport.convertToPdfPoint(dx, dy)

    return {
      page,
      offset: {
        left,
        top: viewport.viewBox[3] - top,
      },
    }
  }

  // get the current page, offset and page size
  get currentPosition() {
    const containerRect = this.container.getBoundingClientRect()

    let pageIndex = this.viewer.currentPageNumber - 1
    for (let i = pageIndex; i >= 0; i--) {
      const pageView = this.viewer.getPageView(i)
      if (!pageView?.div) continue
      const pageRect = pageView.div.getBoundingClientRect()
      if (pageRect.bottom < containerRect.top) {
        pageIndex = i + 1
        break
      }
      pageIndex = i
    }

    const pageView = this.viewer.getPageView(pageIndex)
    const pageRect = pageView.div.getBoundingClientRect()

    const dy = containerRect.top - pageRect.top
    const dx = containerRect.left - pageRect.left
    const [left, top] = pageView.viewport.convertToPdfPoint(dx, dy)
    const [, , width, height] = pageView.viewport.viewBox

    return {
      page: pageIndex,
      offset: { top, left },
      pageSize: { height, width },
    }
  }

  scrollToPosition(position: Record<string, any>, scale = null) {
    const destArray = [
      null,
      {
        name: 'XYZ', // 'XYZ' = scroll to the given coordinates
      },
      position.offset.left,
      position.offset.top,
      scale,
    ]

    this.viewer.scrollPageIntoView({
      pageNumber: position.page + 1,
      destArray,
    })

    // scrollPageIntoView aligns PDF content to the container top, ignoring the page margin.
    // For a top-of-document position this leaves scrollTop = marginTop (margin hidden).
    // Snap back to 0 so the margin is visible, but only when we are in that margin band —
    // for any real mid-document scrollTop this condition is false and we leave it untouched.
    const pageIndex = this.viewer.currentPageNumber - 1
    const pageView = this.viewer.getPageView(pageIndex)
    if (pageView) {
      const marginTop = parseFloat(getComputedStyle(pageView.div).marginTop)
      if (this.viewer.container.scrollTop <= marginTop) {
        this.viewer.container.scrollTop = 0
      }
    }
  }

  isVisible() {
    return this.viewer.container.offsetParent !== null
  }
}
