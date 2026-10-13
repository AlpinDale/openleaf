import { z } from 'zod'

export const CommentContent = z.string().trim().min(1).max(10_000)

export const CommentMessage = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  content: z.string(),
  createdAt: z.number(),
  editedAt: z.number().nullable(),
})
export type CommentMessage = z.infer<typeof CommentMessage>

export const CommentThread = z.object({
  id: z.string(),
  docId: z.string(),
  createdBy: z.string(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
  resolvedBy: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  messages: z.array(CommentMessage),
})
export type CommentThread = z.infer<typeof CommentThread>

export const ThreadList = z.object({ threads: z.array(CommentThread) })

export const CreateThreadBody = z.object({
  id: z.uuid(),
  docId: z.string(),
  content: CommentContent,
})
export const MessageBody = z.object({ content: CommentContent })
