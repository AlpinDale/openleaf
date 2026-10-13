import { z } from 'zod'

export const HISTORY_SOURCES = [
  'create',
  'auto',
  'restore',
  'import',
  'copy',
  'git',
] as const
export type HistorySource = (typeof HISTORY_SOURCES)[number]

export const HistoryLabel = z.object({
  id: z.string(),
  name: z.string(),
  userName: z.string(),
  createdAt: z.number(),
})
export type HistoryLabel = z.infer<typeof HistoryLabel>

export const HistoryVersion = z.object({
  oid: z.string(),
  parentOid: z.string().nullable(),
  createdAt: z.number(),
  source: z.enum(HISTORY_SOURCES),
  message: z.string(),
  authors: z.array(z.object({ id: z.string().nullable(), name: z.string() })),
  changes: z.array(
    z.object({ path: z.string(), op: z.enum(['added', 'modified', 'deleted']) })
  ),
  labels: z.array(HistoryLabel),
})
export type HistoryVersion = z.infer<typeof HistoryVersion>

export const HistoryList = z.object({ versions: z.array(HistoryVersion) })

export const HistoryTreeEntry = z.object({
  path: z.string(),
  kind: z.enum(['text', 'binary']),
  size: z.number(),
})
export type HistoryTreeEntry = z.infer<typeof HistoryTreeEntry>

export const RestoreBody = z.object({ path: z.string().min(1).optional() })
export const CreateLabelBody = z.object({
  oid: z.string().regex(/^[0-9a-f]{40}$/),
  name: z.string().trim().min(1).max(100),
})

export const LabelWithOid = HistoryLabel.extend({ commitOid: z.string() })
export const LabelList = z.object({ labels: z.array(LabelWithOid) })
