import {
  type CommentThread,
  CreateThreadBody,
  MessageBody,
  roleAtLeast,
  YDOC_COMMENTS,
} from '@openleaf/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireProjectRole, userOf } from '../auth/plugin.js'
import {
  commentMessages,
  commentThreads,
  entries,
  users,
} from '../db/schema.js'
import { badRequest, conflict, forbidden, notFound, parse } from '../errors.js'
import { projectLock } from '../tree/locks.js'

type ThreadParams = { id: string; tid: string }
type MessageParams = ThreadParams & { mid: string }

export async function commentRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  const { db } = ctx
  const viewer = { preHandler: requireProjectRole('viewer') }
  const reviewer = { preHandler: requireProjectRole('reviewer') }

  const changed = (projectId: string) =>
    ctx.realtime.broadcast(projectId, { type: 'comments.changed' })

  async function mutate<T>(request: FastifyRequest, fn: () => Promise<T>) {
    return projectLock(request.project.id).runExclusive(async () => {
      // A project or document can disappear while waiting for its mutation
      // lock. Reauthorize against the current membership under that lock.
      await requireProjectRole('reviewer').call(app, request)
      return fn()
    })
  }

  function requireThread(request: FastifyRequest<{ Params: ThreadParams }>) {
    const thread = db
      .select()
      .from(commentThreads)
      .where(
        and(
          eq(commentThreads.id, request.params.tid),
          eq(commentThreads.projectId, request.project.id)
        )
      )
      .get()
    if (!thread) throw notFound('Comment thread not found')
    return thread
  }

  function requireOwnMessage(
    request: FastifyRequest<{ Params: MessageParams }>
  ) {
    requireThread(request)
    const message = db
      .select()
      .from(commentMessages)
      .where(
        and(
          eq(commentMessages.id, request.params.mid),
          eq(commentMessages.threadId, request.params.tid)
        )
      )
      .get()
    if (!message) throw notFound('Message not found')
    if (message.userId !== userOf(request).id) {
      throw forbidden('Only the author can change this message')
    }
    return message
  }

  app.get('/projects/:id/threads', viewer, async request => {
    const threads = db
      .select()
      .from(commentThreads)
      .where(eq(commentThreads.projectId, request.project.id))
      .orderBy(asc(commentThreads.createdAt))
      .all()
    const ids = threads.map(t => t.id)
    const messages = ids.length
      ? db
          .select({
            id: commentMessages.id,
            threadId: commentMessages.threadId,
            userId: commentMessages.userId,
            userName: users.name,
            content: commentMessages.content,
            createdAt: commentMessages.createdAt,
            editedAt: commentMessages.editedAt,
          })
          .from(commentMessages)
          .leftJoin(users, eq(users.id, commentMessages.userId))
          .where(inArray(commentMessages.threadId, ids))
          .orderBy(asc(commentMessages.createdAt))
          .all()
      : []
    const names = new Map(
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          inArray(
            users.id,
            threads.flatMap(t => (t.resolvedBy ? [t.resolvedBy] : []))
          )
        )
        .all()
        .map(u => [u.id, u.name])
    )
    const result: CommentThread[] = threads.map(t => ({
      id: t.id,
      docId: t.docId,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      resolvedBy: t.resolvedBy,
      resolvedByName: t.resolvedBy ? (names.get(t.resolvedBy) ?? null) : null,
      messages: messages
        .filter(m => m.threadId === t.id)
        .map(({ threadId: _threadId, userName, ...m }) => ({
          ...m,
          userName: userName ?? 'Deleted user',
        })),
    }))
    return { threads: result }
  })

  app.post('/projects/:id/threads', reviewer, async (request, reply) =>
    mutate(request, async () => {
      const body = parse(CreateThreadBody, request.body)
      const projectId = request.project.id
      const doc = db
        .select()
        .from(entries)
        .where(eq(entries.id, body.docId))
        .get()
      if (!doc || doc.projectId !== projectId || doc.kind !== 'doc') {
        throw badRequest(
          'Comments can only be added to documents in this project'
        )
      }
      if (
        db
          .select()
          .from(commentThreads)
          .where(eq(commentThreads.id, body.id))
          .get()
      ) {
        throw conflict('A thread with this id already exists')
      }
      const now = Date.now()
      const userId = userOf(request).id
      db.transaction(tx => {
        tx.insert(commentThreads)
          .values({
            id: body.id,
            projectId,
            docId: body.docId,
            createdBy: userId,
            createdAt: now,
          })
          .run()
        tx.insert(commentMessages)
          .values({
            id: crypto.randomUUID(),
            threadId: body.id,
            userId,
            content: body.content,
            createdAt: now,
          })
          .run()
      })
      changed(projectId)
      return reply.status(201).send({ ok: true })
    })
  )

  app.post<{ Params: ThreadParams }>(
    '/projects/:id/threads/:tid/messages',
    reviewer,
    async (request, reply) =>
      mutate(request, async () => {
        const body = parse(MessageBody, request.body)
        const thread = requireThread(request)
        const id = crypto.randomUUID()
        db.insert(commentMessages)
          .values({
            id,
            threadId: thread.id,
            userId: userOf(request).id,
            content: body.content,
            createdAt: Date.now(),
          })
          .run()
        changed(request.project.id)
        return reply.status(201).send({ id })
      })
  )

  app.patch<{ Params: MessageParams }>(
    '/projects/:id/threads/:tid/messages/:mid',
    reviewer,
    async request =>
      mutate(request, async () => {
        const body = parse(MessageBody, request.body)
        const message = requireOwnMessage(request)
        db.update(commentMessages)
          .set({ content: body.content, editedAt: Date.now() })
          .where(eq(commentMessages.id, message.id))
          .run()
        changed(request.project.id)
        return { ok: true }
      })
  )

  app.delete<{ Params: MessageParams }>(
    '/projects/:id/threads/:tid/messages/:mid',
    reviewer,
    async request =>
      mutate(request, async () => {
        const message = requireOwnMessage(request)
        db.delete(commentMessages)
          .where(eq(commentMessages.id, message.id))
          .run()
        changed(request.project.id)
        return { ok: true }
      })
  )

  for (const [action, resolved] of [
    ['resolve', true],
    ['reopen', false],
  ] as const) {
    app.post<{ Params: ThreadParams }>(
      `/projects/:id/threads/:tid/${action}`,
      reviewer,
      async request =>
        mutate(request, async () => {
          const thread = requireThread(request)
          db.update(commentThreads)
            .set(
              resolved
                ? { resolvedAt: Date.now(), resolvedBy: userOf(request).id }
                : { resolvedAt: null, resolvedBy: null }
            )
            .where(eq(commentThreads.id, thread.id))
            .run()
          changed(request.project.id)
          return { ok: true }
        })
    )
  }

  app.delete<{ Params: ThreadParams }>(
    '/projects/:id/threads/:tid',
    reviewer,
    async request =>
      mutate(request, async () => {
        const thread = requireThread(request)
        if (
          thread.createdBy !== userOf(request).id &&
          !roleAtLeast(request.role, 'editor')
        ) {
          throw forbidden('Only the thread author or an editor can delete it')
        }
        await ctx.realtime.withProjectDoc(request.project.id, doc => {
          doc.getMap(YDOC_COMMENTS).delete(thread.id)
        })
        db.delete(commentThreads).where(eq(commentThreads.id, thread.id)).run()
        changed(request.project.id)
        return { ok: true }
      })
  )
}
