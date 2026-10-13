import { z } from 'zod'

export const YDOC_TEXTS = 'texts'
export const YDOC_COMMENTS = 'comments'
export const YDOC_CHANGES = 'changes'
export const YDOC_TRACK_CHANGES = 'trackChanges'
export const TRACK_CHANGES_ALL = '__all__'

export const projectDocumentName = (projectId: string) => `project.${projectId}`

export const PROJECT_DOCUMENT_NAME_RE = /^project\.([0-9a-f-]{36})$/

/**
 * Reasons the server sends when it closes a client's project document.
 * Permanent failures require recovery; rate limits allow reconnecting with
 * local changes retained.
 */
export const FORCED_CLOSE_REASONS = {
  projectDeleted: 'openleaf:project-deleted',
  updateTooLarge: 'openleaf:update-too-large',
  stateTooLarge: 'openleaf:state-too-large',
  invalidUpdate: 'openleaf:invalid-update',
  rateLimited: 'openleaf:rate-limited',
} as const
export type ForcedCloseReason =
  (typeof FORCED_CLOSE_REASONS)[keyof typeof FORCED_CLOSE_REASONS]

/** Largest single realtime update the server accepts (bytes). */
export const MAX_REALTIME_UPDATE_BYTES = 16 * 1024 * 1024

export const ProjectEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tree.changed') }),
  z.object({ type: z.literal('project.updated') }),
  z.object({ type: z.literal('comments.changed') }),
  z.object({ type: z.literal('history.committed'), oid: z.string() }),
  z.object({
    type: z.literal('compile.finished'),
    userId: z.string(),
    buildId: z.string().nullable(),
    status: z.string(),
  }),
])
export type ProjectEvent = z.infer<typeof ProjectEvent>
