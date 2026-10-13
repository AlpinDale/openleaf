import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/i18n'
import LoadingSpinner from '@/shared/components/loading-spinner'

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

/** Renders page 1 of a PDF into a canvas sized to the container width. */
export function PdfFirstPage({ url }: { url: string }) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    let destroy: (() => void) | undefined
    setState('loading')
    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        const task = pdfjs.getDocument({ url, withCredentials: true })
        destroy = () => void task.destroy()
        const pdf = await task.promise
        const page = await pdf.getPage(1)
        const element = canvas.current
        if (cancelled || !element) return
        const available = element.parentElement?.clientWidth ?? 800
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2, Math.max(0.25, (available - 32) / base.width))
        const ratio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * ratio })
        element.width = viewport.width
        element.height = viewport.height
        element.style.width = `${viewport.width / ratio}px`
        element.style.height = `${viewport.height / ratio}px`
        await page.render({ canvas: element, viewport }).promise
        if (!cancelled) setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
      destroy?.()
    }
  }, [url])

  return (
    <>
      {state === 'loading' && <LoadingSpinner />}
      {state === 'error' && (
        <p className="text-danger">{t('file_preview_failed')}</p>
      )}
      <canvas
        ref={canvas}
        className="file-view-pdf"
        data-testid="file-view-pdf"
        hidden={state !== 'ready'}
      />
    </>
  )
}
