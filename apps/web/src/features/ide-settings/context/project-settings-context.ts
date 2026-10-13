import { useUserSettingsContext } from '@/shared/context/user-settings-context'

export function useProjectSettingsContext() {
  const { setUserSettings } = useUserSettingsContext()
  return {
    setMathPreview: (mathPreview: boolean) => setUserSettings({ mathPreview }),
  }
}
