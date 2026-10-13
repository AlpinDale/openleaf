import type { ExportFormat } from '@openleaf/shared'
import { errorMessage, isApiError } from '@/api/client'
import { downloadProjectExport } from '@/api/projects'
import { dismissToast, showToast } from '@/features/toasts'
import { t } from '@/i18n'

/** Menu handler for "Export as Word/Markdown/HTML"; failures become toasts. */
export async function exportProject(projectId: string, format: ExportFormat) {
  const pending = showToast({
    type: 'info',
    content: t('exporting_project'),
    delay: null,
  })
  try {
    await downloadProjectExport(projectId, format)
  } catch (err) {
    showToast({
      type: 'error',
      title: t('export_failed'),
      content: isApiError(err, 'converter_unavailable')
        ? t('export_converter_unavailable')
        : errorMessage(err),
    })
  } finally {
    dismissToast(pending)
  }
}
