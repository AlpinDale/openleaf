import { isApiError } from '@/api/client'
import { t } from '@/i18n'

/**
 * Runs an upload/import; when the target name already exists, asks whether
 * to replace it and retries with `overwrite`.
 */
export async function replaceOnConflict<T>(
  name: string,
  run: (overwrite: boolean) => Promise<T>
): Promise<T> {
  try {
    return await run(false)
  } catch (error) {
    if (
      isApiError(error, 'conflict') &&
      window.confirm(t('file_already_exists_replace', { name }))
    ) {
      return run(true)
    }
    throw error
  }
}
