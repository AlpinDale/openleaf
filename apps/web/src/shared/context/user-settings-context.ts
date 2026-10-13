import type { UserSettings } from '@openleaf/shared'
import { useCallback, useMemo } from 'react'
import { patchMe } from '@/api/auth'
import { useIdeUserSettings } from '@/features/ide-react/openleaf-ide'
import { showToast } from '@/features/toasts'

export type Keybindings = 'none' | 'vim' | 'emacs'

/** Overleaf's user settings shape, mapped from OpenLeaf `UserSettings`. */
export function useUserSettingsContext() {
  const settings = useIdeUserSettings()
  const userSettings = useMemo(
    () => ({
      ...settings,
      mode: (settings.keybindings === 'default'
        ? 'none'
        : settings.keybindings) as Keybindings,
    }),
    [settings]
  )
  const setUserSettings = useCallback((patch: Partial<UserSettings>) => {
    patchMe({ settings: patch }).catch(err =>
      showToast({ type: 'error', content: (err as Error).message })
    )
  }, [])
  return { userSettings, setUserSettings }
}
