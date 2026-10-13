import type { UserSettings } from '@openleaf/shared'
import { useEffect, useSyncExternalStore } from 'react'

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function subscribe(onChange: () => void) {
  const query = darkQuery()
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Resolves `system` against the live `prefers-color-scheme`. */
export function useResolvedTheme(
  overallTheme: UserSettings['overallTheme']
): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(subscribe, () => darkQuery().matches)
  if (overallTheme === 'system') return systemDark ? 'dark' : 'light'
  return overallTheme
}

/**
 * Keeps `<html data-theme>` in sync with the user's overall theme. The ported
 * Overleaf SCSS calls its dark theme `default` (see `@mixin theme`).
 */
export function useApplyTheme(overallTheme: UserSettings['overallTheme']) {
  const theme = useResolvedTheme(overallTheme)
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === 'dark' ? 'default' : 'light'
  }, [theme])
}
