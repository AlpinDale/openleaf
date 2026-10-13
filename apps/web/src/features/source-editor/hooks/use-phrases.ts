import { useTranslation } from '@/i18n'
import { useMemo } from 'react'

/** Translations for CodeMirror's built-in phrases. */
export const usePhrases = (): Record<string, string> => {
  const { t } = useTranslation()

  return useMemo(
    () => ({
      'Fold line': t('fold_line'),
      'Unfold line': t('unfold_line'),
    }),
    [t]
  )
}
