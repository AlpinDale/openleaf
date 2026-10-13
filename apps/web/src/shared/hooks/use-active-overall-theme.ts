import { useEffect, useState } from 'react'
import { useIdeUserSettings } from '@/features/ide-react/openleaf-ide'

export type ActiveOverallTheme = 'dark' | 'light'

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)')

export const useActiveOverallTheme = (): ActiveOverallTheme => {
  const { overallTheme } = useIdeUserSettings()
  const [prefersDark, setPrefersDark] = useState(
    () => darkQuery()?.matches ?? false
  )

  useEffect(() => {
    const watcher = darkQuery()
    if (!watcher) return
    const listener = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    watcher.addEventListener('change', listener)
    return () => watcher.removeEventListener('change', listener)
  }, [])

  if (overallTheme === 'system') return prefersDark ? 'dark' : 'light'
  return overallTheme
}
