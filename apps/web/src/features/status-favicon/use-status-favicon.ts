// Adapted from Overleaf services/web/frontend/js/features/ide-react/hooks/use-status-favicon.ts (AGPL-3.0);
// the status badges are Overleaf's favicon-{compiling,compiled,error}.svg overlays.
import { useEffect, useState } from 'react'
import {
  type CompileUiStatus,
  useCompileStore,
} from '@/features/pdf-preview/compile-store'

/** How long a finished compile's badge stays while the tab is visible. */
const RESET_AFTER_MS = 5_000

type FaviconStatus = 'uncompiled' | 'compiling' | 'compiled' | 'error'

const BASE =
  '<circle cx="8" cy="8" r="8" fill="#046530"/>' +
  '<path d="M11.5 4.5C7 4 4.5 6.5 4.5 10.5c0 .4.1.8.2 1.1C6 8.8 8 7.4 10.2 6.6 8.3 7.8 6.6 9.6 5.6 12c3.9.3 6.4-2.6 5.9-7.5Z" fill="#fff"/>'

const BADGE = '<circle cx="10.5" cy="11.5" r="3.5" fill="#fff"/>'

const BADGES: Record<Exclude<FaviconStatus, 'uncompiled'>, string> = {
  compiling: `${BADGE}<path fill="#000" d="M10.5 9.2a2.3 2.3 0 1 0 2.3 2.3h-.7a1.6 1.6 0 1 1-1.6-1.6v.8l1.2-1.1-1.2-1.1Z"/>`,
  compiled: `${BADGE}<path fill="#000" d="m9.615 12.032 2.75-2.921a.31.31 0 0 1 .26-.111q.146 0 .26.122a.395.395 0 0 1 0 .555l-3 3.2a.349.349 0 0 1-.531 0l-1.24-1.322a.395.395 0 0 1 0-.556.35.35 0 0 1 .261-.122q.146 0 .26.122z"/>`,
  error: `${BADGE}<path fill="#000" d="m10.5 12.064-1.814 1.814a.38.38 0 0 1-.277.122.43.43 0 0 1-.276-.133.38.38 0 0 1-.122-.276q0-.166.122-.288L9.936 11.5 8.122 9.686A.38.38 0 0 1 8 9.409a.44.44 0 0 1 .133-.287A.38.38 0 0 1 8.409 9q.166 0 .288.122l1.803 1.814 1.814-1.814A.38.38 0 0 1 12.591 9q.165 0 .287.122a.4.4 0 0 1 .122.287q0 .156-.122.277L11.064 11.5l1.814 1.814a.38.38 0 0 1 .122.277q0 .155-.122.276a.4.4 0 0 1-.287.122.38.38 0 0 1-.277-.122z"/>`,
}

function faviconUrl(status: FaviconStatus) {
  const badge = status === 'uncompiled' ? '' : BADGES[status]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${BASE}${badge}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function faviconStatus(
  status: CompileUiStatus,
  error: string | null
): FaviconStatus {
  if (status === 'compiling') return 'compiling'
  if (status === 'idle') return error ? 'error' : 'uncompiled'
  return status === 'success' ? 'compiled' : 'error'
}

function setFavicon(status: FaviconStatus) {
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[data-compile-status]'
  )
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.dataset.compileStatus = 'true'
    document.head.appendChild(link)
  }
  link.dataset.compileStatus = status
  link.href = faviconUrl(status)
}

function useIsWindowActive() {
  const [active, setActive] = useState(!document.hidden)
  useEffect(() => {
    const onChange = () => setActive(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return active
}

/**
 * Badges the tab's favicon with the compile state (compiling / compiled /
 * error). A finished state falls back to the plain icon 5 s after it is seen,
 * so a background tab keeps the badge until the user looks at it.
 */
export function useStatusFavicon() {
  const status = useCompileStore(s => faviconStatus(s.status, s.error))
  const windowActive = useIsWindowActive()

  // the badge for each new state; leaving the page removes it
  useEffect(() => {
    setFavicon(status)
    return () =>
      document.head.querySelector('link[data-compile-status]')?.remove()
  }, [status])

  useEffect(() => {
    if (!windowActive || (status !== 'compiled' && status !== 'error')) return
    const timer = window.setTimeout(
      () => setFavicon('uncompiled'),
      RESET_AFTER_MS
    )
    return () => window.clearTimeout(timer)
  }, [status, windowActive])
}
