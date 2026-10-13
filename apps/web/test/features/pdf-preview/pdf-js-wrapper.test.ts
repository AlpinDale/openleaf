// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/infrastructure/error-reporter', () => ({
  captureException: vi.fn(),
}))
vi.mock('@/features/source-editor/extensions/browser', () => ({
  default: { safari: false },
}))
vi.mock('@/features/pdf-preview/util/pdf-js', () => ({
  loadPdfDocumentFromUrl: mocks.load,
  imageResourcesPath: '',
  PDFJS: {
    AnnotationMode: { ENABLE: 1 },
    AnnotationEditorType: { DISABLE: 0 },
    ResponseException: class extends Error {},
  },
}))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  PDFViewer: class {
    setDocument = vi.fn()
  },
  EventBus: class {
    on = vi.fn()
    off = vi.fn()
  },
  PDFLinkService: class {
    setViewer = vi.fn()
    setDocument = vi.fn()
  },
  LinkTarget: { BLANK: 2 },
}))
import PDFJSWrapper from '@/features/pdf-preview/util/pdf-js-wrapper'

function loadingTask() {
  const { promise, resolve } = Promise.withResolvers<{ numPages: number }>()
  return { promise, resolve, destroy: vi.fn().mockResolvedValue(undefined) }
}
function wrapper() {
  const container = document.createElement('div')
  container.innerHTML = '<div class="pdfViewer"></div>'
  return new PDFJSWrapper(container)
}

describe('PDF loading task ownership', () => {
  it('isolates consecutive loads of the same URL', async () => {
    const first = loadingTask()
    const second = loadingTask()
    mocks.load.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const viewer = wrapper()
    const oldLoad = viewer.loadDocument({ url: '/output.pdf' })
    const newLoad = viewer.loadDocument({ url: '/output.pdf' })
    const current = { numPages: 2 }
    second.resolve(current)
    await newLoad
    first.resolve({ numPages: 1 })
    await oldLoad
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(viewer.viewer.setDocument).toHaveBeenCalledExactlyOnceWith(current)
    viewer.destroy()
    expect(second.destroy).toHaveBeenCalledOnce()
  })

  it('destroys pending loads without installing a document after unmount', async () => {
    const task = loadingTask()
    mocks.load.mockReturnValueOnce(task)
    const viewer = wrapper()
    const pending = viewer.loadDocument({ url: '/output.pdf' })
    viewer.destroy()
    task.resolve({ numPages: 1 })
    await pending
    expect(task.destroy).toHaveBeenCalledOnce()
    expect(viewer.viewer.setDocument).toHaveBeenCalledExactlyOnceWith(null)
  })
})
