import * as PDFJS from 'pdfjs-dist'
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

export { PDFJS }

PDFJS.GlobalWorkerOptions.workerPort = new Worker(pdfWorkerUrl, {
  type: 'module',
})

export const imageResourcesPath = '/images/pdfjs-dist/'

const params = new URLSearchParams(window.location.search)
const disableFontFace = params.get('disable-font-face') === 'true'

export const loadPdfDocumentFromUrl = (
  url: string,
  options: Partial<DocumentInitParameters> = {}
) =>
  PDFJS.getDocument({
    url,
    disableFontFace,
    disableAutoFetch: true, // only fetch the data needed for the displayed pages
    disableStream: true,
    enableXfa: false, // default is false (2021-10-12), but set explicitly to be sure
    ...options,
  })
