import { z } from 'zod'

export const EXPORT_FORMATS = ['docx', 'md', 'html'] as const
export const ExportFormat = z.enum(EXPORT_FORMATS)
export type ExportFormat = z.infer<typeof ExportFormat>

/** `GET /api/config`: instance-wide capabilities the UI adapts to. */
export const AppConfig = z.object({
  /** Whether the document converter (pandoc) is available for exports. */
  exports: z.boolean(),
  /** "Contact us" link target; `null` hides the entry. */
  supportUrl: z.string().nullable(),
})
export type AppConfig = z.infer<typeof AppConfig>
