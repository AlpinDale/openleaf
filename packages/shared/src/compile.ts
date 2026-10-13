import { z } from 'zod'

export const CompileBody = z.object({
  draft: z.boolean().default(false),
  stopOnFirstError: z.boolean().default(false),
  syntaxCheck: z.boolean().default(false),
})
export type CompileOptions = z.infer<typeof CompileBody>

export const COMPILE_STATUSES = [
  'success',
  'failure',
  'timedout',
  'terminated',
  'no-root-doc',
  'validation-problems',
] as const
export type CompileStatus = (typeof COMPILE_STATUSES)[number]

export const ChktexEntry = z.object({
  path: z.string(),
  line: z.number(),
  column: z.number(),
  kind: z.enum(['Warning', 'Error', 'Message']),
  code: z.number(),
  message: z.string(),
})
export type ChktexEntry = z.infer<typeof ChktexEntry>

export const OutputFile = z.object({
  path: z.string(),
  url: z.string(),
  size: z.number(),
  type: z.string(),
})
export type OutputFile = z.infer<typeof OutputFile>

export const CompileResponse = z.object({
  status: z.enum(COMPILE_STATUSES),
  buildId: z.string().nullable(),
  rootDocPath: z.string().nullable(),
  outputFiles: z.array(OutputFile),
  chktex: z.array(ChktexEntry),
  logPathPrefix: z.string(),
  durationMs: z.number(),
})
export type CompileResponse = z.infer<typeof CompileResponse>

export const SynctexPdfPosition = z.object({
  page: z.number(),
  h: z.number(),
  v: z.number(),
  width: z.number(),
  height: z.number(),
})
export type SynctexPdfPosition = z.infer<typeof SynctexPdfPosition>

export const SynctexCodePosition = z.object({
  path: z.string(),
  line: z.number(),
  column: z.number(),
})
export type SynctexCodePosition = z.infer<typeof SynctexCodePosition>

export const WordCount = z.object({
  encode: z.string(),
  textWords: z.number(),
  headWords: z.number(),
  outside: z.number(),
  headers: z.number(),
  elements: z.number(),
  mathInline: z.number(),
  mathDisplay: z.number(),
  errors: z.number(),
  messages: z.string(),
})
export type WordCount = z.infer<typeof WordCount>
