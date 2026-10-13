import { z } from 'zod'

const fields = {
  overallTheme: z.enum(['system', 'light', 'dark']),
  editorTheme: z.string().min(1).max(100),
  keybindings: z.enum(['default', 'vim', 'emacs']),
  fontSize: z.number().int().min(10).max(24),
  fontFamily: z.enum(['monaco', 'lucida', 'opendyslexicmono']),
  lineHeight: z.enum(['compact', 'normal', 'wide']),
  autoComplete: z.boolean(),
  autoPairDelimiters: z.boolean(),
  syntaxValidation: z.boolean(),
  mathPreview: z.boolean(),
  pdfDarkMode: z.boolean(),
  autoCompile: z.boolean(),
  compileDraft: z.boolean(),
  compileSyntaxCheck: z.boolean(),
  compileStopOnFirstError: z.boolean(),
  editorMode: z.enum(['source', 'visual']),
  editorTabs: z.boolean(),
  previewEditorTabs: z.boolean(),
  breadcrumbs: z.boolean(),
  nonBlinkingCursor: z.boolean(),
  selectionQuickActions: z.boolean(),
  pdfViewer: z.enum(['pdfjs', 'native']),
  referencesSearchMode: z.enum(['advanced', 'simple']),
}

export type UserSettings = {
  [K in keyof typeof fields]: z.infer<(typeof fields)[K]>
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  overallTheme: 'system',
  editorTheme: 'textmate',
  keybindings: 'default',
  fontSize: 12,
  fontFamily: 'monaco',
  lineHeight: 'normal',
  autoComplete: true,
  autoPairDelimiters: true,
  syntaxValidation: true,
  mathPreview: true,
  pdfDarkMode: false,
  autoCompile: true,
  compileDraft: false,
  compileSyntaxCheck: false,
  compileStopOnFirstError: false,
  editorMode: 'source',
  editorTabs: true,
  previewEditorTabs: true,
  breadcrumbs: true,
  nonBlinkingCursor: false,
  selectionQuickActions: true,
  pdfViewer: 'pdfjs',
  referencesSearchMode: 'advanced',
}

/** Partial settings update (strict: unknown keys and invalid values are rejected). */
export const UserSettingsPatchSchema = z.object(fields).partial().strict()
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>

/** Full settings; missing or invalid stored values fall back to defaults. */
export function parseUserSettings(value: unknown): UserSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >
  const result: Record<string, unknown> = { ...DEFAULT_USER_SETTINGS }
  for (const [key, schema] of Object.entries(fields)) {
    const parsed = (schema as z.ZodType).safeParse(input[key])
    if (parsed.success) result[key] = parsed.data
  }
  return result as UserSettings
}

/** API responses require complete, valid settings; storage uses parseUserSettings. */
export const UserSettingsSchema = z.object(fields)
