import {
  type Connection,
  Hocuspocus,
  IncomingMessage,
  MessageType,
} from '@hocuspocus/server'
import {
  FORCED_CLOSE_REASONS,
  type ForcedCloseReason,
  MAX_REALTIME_UPDATE_BYTES,
  PROJECT_DOCUMENT_NAME_RE,
  type ProjectEvent,
  projectDocumentName,
  type Role,
} from '@openleaf/shared'
import { Mutex } from 'async-mutex'
import { and, eq, gt, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  resolveSession,
  sessionTokenFromCookieHeader,
} from '../auth/sessions.js'
import { sha256Hex } from '../auth/tokens.js'
import type { Config } from '../config.js'
import type { Db } from '../db/index.js'
import {
  projectMembers,
  projects,
  projectYdocs,
  sessions,
} from '../db/schema.js'
import { tooLarge } from '../errors.js'
import { projectLock } from '../tree/locks.js'
import { assertProjectStateWithinLimit, ProjectAdmission } from './admission.js'
import { createProjectEvents } from './events.js'
import { SocketAdmission, type SocketAttachment } from './socket-admission.js'

export type ConnectionContext =
  | { userId: string; role: Role; system?: false; leaseId?: string }
  | { system: true; userId?: string | null }

const UPDATED_AT_THROTTLE_MS = 30_000
/** Close code sent with every `ForcedCloseReason`. */
const FORCED_CLOSE_CODE = 4403

function projectIdOf(documentName: string): string | null {
  return PROJECT_DOCUMENT_NAME_RE.exec(documentName)?.[1] ?? null
}

export type Realtime = ReturnType<typeof createRealtime>

export function createRealtime(db: Db, config: Config) {
  const lastUpdatedAt = new Map<string, number>()
  const events = createProjectEvents()
  const connections = new Set<Connection<ConnectionContext>>()
  const retiringProjects = new Set<string>()
  const admissions = new Map<
    string,
    { mirror: ProjectAdmission; lock: Mutex; retiring: AbortController }
  >()
  const admissionReleases = new WeakMap<
    Connection<ConnectionContext>,
    () => void
  >()
  const awarenessFrames = new WeakMap<
    Connection<ConnectionContext>,
    { clients: Set<number>; removed: Set<number> }
  >()
  let shuttingDown = false
  const sockets = new Map<
    string,
    SocketAttachment & {
      userId: string
      sessionId: string
      close: (code: number, reason: string) => void
    }
  >()
  const socketCounts = new Map<string, number>()
  const logicalLeases = new Map<
    string,
    { userId: string; socketId: string; documentName: string; active: boolean }
  >()
  const logicalCounts = new Map<string, number>()

  function releaseLease(id: string | undefined) {
    if (!id) return
    const lease = logicalLeases.get(id)
    if (!lease) return
    logicalLeases.delete(id)
    const count = (logicalCounts.get(lease.userId) ?? 1) - 1
    if (count) logicalCounts.set(lease.userId, count)
    else logicalCounts.delete(lease.userId)
  }

  function openSocket(
    userId: string,
    sessionId: string,
    close: (code: number, reason: string) => void
  ): SocketAttachment {
    if (
      shuttingDown ||
      (socketCounts.get(userId) ?? 0) >= config.maxRealtimeConnectionsPerUser
    )
      throw {
        code: FORCED_CLOSE_CODE,
        reason: FORCED_CLOSE_REASONS.rateLimited,
      }
    const attachment = {
      id: crypto.randomUUID(),
      admission: new SocketAdmission(config),
      userId,
      sessionId,
      close,
    }
    sockets.set(attachment.id, attachment)
    socketCounts.set(userId, (socketCounts.get(userId) ?? 0) + 1)
    return attachment
  }

  function closeSocket(id: string) {
    const socket = sockets.get(id)
    if (!socket) return
    socket.admission.destroy()
    sockets.delete(id)
    const count = (socketCounts.get(socket.userId) ?? 1) - 1
    if (count) socketCounts.set(socket.userId, count)
    else socketCounts.delete(socket.userId)
    // Authentication may have reserved a slot while createDocument is still
    // loading. Keep it charged until the load settles; active connections
    // retain theirs until their accepted message queues have drained.
    void Promise.allSettled(hocuspocus.loadingDocuments.values()).then(() => {
      for (const [leaseId, lease] of logicalLeases)
        if (lease.socketId === id && !lease.active) releaseLease(leaseId)
    })
  }

  function authorize(connection: Connection<ConnectionContext>) {
    const context = connection.context
    if (!context || context.system) return
    const token = sessionTokenFromCookieHeader(
      connection.request.headers.get('cookie') ?? undefined
    )
    const session = token
      ? db
          .select({ userId: sessions.userId })
          .from(sessions)
          .where(
            and(
              eq(sessions.id, sha256Hex(token)),
              gt(sessions.expiresAt, Date.now())
            )
          )
          .get()
      : null
    const projectId = projectIdOf(connection.document.name)
    const member = projectId
      ? db
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, context.userId)
            )
          )
          .get()
      : null
    if (session?.userId !== context.userId)
      throw { code: 4401, reason: 'Not logged in' }
    if (!member) throw { code: 4401, reason: 'Not authorized' }
    connection.readOnly = member.role === 'viewer'
    if (context.role !== member.role)
      connection.document.broadcastStateless(
        JSON.stringify({ type: 'project.updated' } satisfies ProjectEvent)
      )
    context.role = member.role
  }

  async function acquireMutationLock(lock: Mutex, signal: AbortSignal) {
    const acquired = Promise.withResolvers<() => void>()
    const abort = () => acquired.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    lock.acquire().then(release => {
      if (signal.aborted) release()
      else acquired.resolve(release)
    }, acquired.reject)
    try {
      return await acquired.promise
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  const hocuspocus = new Hocuspocus<ConnectionContext>({
    debounce: 2000,
    maxDebounce: 10000,
    quiet: true,

    async onConnect() {
      if (shuttingDown) throw new Error('Server is shutting down')
    },

    async connected({ connection, context }) {
      // A rejected document frame must not be retried indefinitely through the
      // same authenticated transport, bypassing the upgrade rate limit.
      connection.onClose((_document, event) => {
        if (
          (event?.code === FORCED_CLOSE_CODE &&
            event.reason !== FORCED_CLOSE_REASONS.projectDeleted) ||
          (event?.code === 4401 && event.reason === 'Not logged in')
        ) {
          sockets
            .get(
              connection.request.headers.get('x-openleaf-internal-socket') ?? ''
            )
            ?.close(
              event.code,
              event.reason ?? FORCED_CLOSE_REASONS.invalidUpdate
            )
        }
      })
      const lease =
        !context.system && context.leaseId
          ? logicalLeases.get(context.leaseId)
          : undefined
      if (lease) lease.active = true
      connections.add(connection)
      if (shuttingDown || !lease || !sockets.has(lease.socketId)) {
        connection.close({ code: 1012, reason: 'Server is shutting down' })
      }
    },

    async onDisconnect({ socketId, documentName, requestHeaders, context }) {
      // Upstream calls this only after queued processing resolves. Multiplexed
      // providers for the same project may close together; drain each one.
      for (const connection of connections) {
        if (
          connection.socketId !== socketId ||
          connection.document.name !== documentName ||
          connection.document.hasConnection(connection)
        )
          continue
        await connection.waitForPendingMessages()
        sockets
          .get(requestHeaders.get('x-openleaf-internal-socket') ?? '')
          ?.admission.disconnect(connection.messageAddress)
        connections.delete(connection)
      }
      if (!context.system) releaseLease(context.leaseId)
    },

    async beforeHandleMessage({ update, documentName, connection }) {
      const projectId = projectIdOf(documentName)
      if (projectId && retiringProjects.has(projectId))
        throw {
          code: FORCED_CLOSE_CODE,
          reason: FORCED_CLOSE_REASONS.projectDeleted,
        }
      authorize(connection)
      const message = new IncomingMessage(update)
      message.readVarString()
      if (message.readVarUint() === MessageType.Awareness) {
        const payload = message.readVarUint8Array()
        const decoded = new IncomingMessage(payload)
        const count = decoded.readVarUint()
        if (payload.byteLength > 64 * 1024 || count > 64)
          throw {
            code: FORCED_CLOSE_CODE,
            reason: FORCED_CLOSE_REASONS.updateTooLarge,
          }
        const clients = new Set<number>()
        const removed = new Set<number>()
        let nodes = 0
        const validate = (value: unknown, depth: number): void => {
          if (++nodes > 4096 || depth > 32)
            throw {
              code: FORCED_CLOSE_CODE,
              reason: FORCED_CLOSE_REASONS.stateTooLarge,
            }
          if (value && typeof value === 'object')
            for (const key in value)
              validate((value as Record<string, unknown>)[key], depth + 1)
        }
        for (let i = 0; i < count; i++) {
          const id = decoded.readVarUint()
          decoded.readVarUint() // Awareness clock, never an authorization ID.
          clients.add(id)
          let state: unknown
          try {
            state = JSON.parse(decoded.readVarString())
          } catch {
            throw {
              code: FORCED_CLOSE_CODE,
              reason: FORCED_CLOSE_REASONS.invalidUpdate,
            }
          }
          validate(state, 0)
          if (state === null) removed.add(id)
        }
        if (decoded.decoder.pos !== payload.byteLength)
          throw {
            code: FORCED_CLOSE_CODE,
            reason: FORCED_CLOSE_REASONS.invalidUpdate,
          }
        awarenessFrames.set(connection, { clients, removed })
      }
      if (update.byteLength > MAX_REALTIME_UPDATE_BYTES) {
        throw {
          code: FORCED_CLOSE_CODE,
          reason: FORCED_CLOSE_REASONS.updateTooLarge,
        }
      }
    },

    async beforeSync({ documentName, connection, type, payload }) {
      if (type === 0 || connection.readOnly) return
      const admission = admissions.get(documentName)
      const projectId = projectIdOf(documentName)
      if (!admission || !projectId)
        throw new Error('Missing project admission state')
      const releaseProject = await acquireMutationLock(
        projectLock(projectId),
        admission.retiring.signal
      )
      let releaseAdmission: (() => void) | undefined
      try {
        releaseAdmission = await admission.lock.acquire()
        authorize(connection)
        if (connection.readOnly) {
          releaseAdmission()
          releaseProject()
          return
        }
        if (retiringProjects.has(projectId))
          throw {
            code: FORCED_CLOSE_CODE,
            reason: FORCED_CLOSE_REASONS.projectDeleted,
          }
        const actor = connection.context
        if (actor.system) throw new Error('Client cannot use system context')
        admission.mirror.admit(payload, actor)
        const release = releaseAdmission
        admissionReleases.set(connection, () => {
          release()
          releaseProject()
        })
      } catch (error) {
        releaseAdmission?.()
        releaseProject()
        if (error && typeof error === 'object' && 'reason' in error) throw error
        throw {
          code: FORCED_CLOSE_CODE,
          reason:
            error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            error.statusCode === 413
              ? FORCED_CLOSE_REASONS.stateTooLarge
              : FORCED_CLOSE_REASONS.invalidUpdate,
        }
      }
    },

    async afterHandleMessage({ connection, update, requestHeaders }) {
      admissionReleases.get(connection)?.()
      admissionReleases.delete(connection)
      sockets
        .get(requestHeaders.get('x-openleaf-internal-socket') ?? '')
        ?.admission.complete(update)
    },

    async beforeHandleAwareness({ connection, states, document }) {
      if (!connection) return
      const frame = awarenessFrames.get(connection)
      if (!frame)
        throw {
          code: FORCED_CLOSE_CODE,
          reason: FORCED_CLOSE_REASONS.invalidUpdate,
        }
      // Upstream scratch Awareness initializes its own random client state.
      // Never forward that synthetic state as an actual browser presence.
      for (const id of states.keys())
        if (!frame.clients.has(id)) states.delete(id)
      const active = new Set(document.awareness.getStates().keys())
      for (const id of frame.removed) {
        active.delete(id)
        // Upstream's scratch map omits null removals, but re-encodes only map
        // keys. A null sentinel retains that wire-protocol removal safely.
        states.set(id, null as never)
      }
      for (const [id, state] of states) {
        if (state === null) continue
        if (Buffer.byteLength(JSON.stringify(state)) > 64 * 1024)
          throw {
            code: FORCED_CLOSE_CODE,
            reason: FORCED_CLOSE_REASONS.updateTooLarge,
          }
        active.add(id)
      }
      if (active.size > config.maxRealtimeConnectionsPerUser * 2 + 1)
        throw {
          code: FORCED_CLOSE_CODE,
          reason: FORCED_CLOSE_REASONS.stateTooLarge,
        }
      awarenessFrames.delete(connection)
    },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const socketId = requestHeaders.get('x-openleaf-internal-socket') ?? ''
      const socket = sockets.get(socketId)
      socket?.admission.completeAuthentication(documentName)
      const projectId = projectIdOf(documentName)
      if (shuttingDown) throw new Error('Server is shutting down')
      if (projectId && retiringProjects.has(projectId))
        throw new Error('Project is being deleted')
      if (!projectId) throw new Error('Unknown document')
      const token = sessionTokenFromCookieHeader(
        requestHeaders.get('cookie') ?? undefined
      )
      const session = token ? resolveSession(db, token) : null
      if (!session) throw new Error('Not logged in')
      const member = db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, session.user.id)
          )
        )
        .get()
      if (!member) throw new Error('Not a project member')
      if (
        !socket ||
        socket.userId !== session.user.id ||
        socket.sessionId !== sha256Hex(token as string)
      )
        throw new Error('Not logged in')
      const count = logicalCounts.get(session.user.id) ?? 0
      if (count >= config.maxRealtimeConnectionsPerUser) {
        socket.close(FORCED_CLOSE_CODE, FORCED_CLOSE_REASONS.rateLimited)
        throw {
          code: FORCED_CLOSE_CODE,
          reason: FORCED_CLOSE_REASONS.rateLimited,
        }
      }
      const leaseId = crypto.randomUUID()
      logicalLeases.set(leaseId, {
        userId: session.user.id,
        socketId,
        documentName,
        active: false,
      })
      logicalCounts.set(session.user.id, count + 1)
      if (member.role === 'viewer') connectionConfig.readOnly = true
      return {
        userId: session.user.id,
        role: member.role,
        leaseId,
      } satisfies ConnectionContext
    },

    async onLoadDocument({ documentName, document }) {
      try {
        const projectId = projectIdOf(documentName)
        if (!projectId) throw new Error('Unknown document')
        if (retiringProjects.has(projectId))
          throw new Error('Project is being deleted')
        const size = db
          .select({ bytes: sql<number>`length(${projectYdocs.state})` })
          .from(projectYdocs)
          .where(eq(projectYdocs.projectId, projectId))
          .get()
        if (!size) throw new Error(`No Y state for project ${projectId}`)
        if (size.bytes > config.maxProjectStateBytes)
          throw tooLarge('Project realtime state is too large')
        const row = db
          .select({ state: projectYdocs.state })
          .from(projectYdocs)
          .where(eq(projectYdocs.projectId, projectId))
          .get()
        if (!row) throw new Error(`No Y state for project ${projectId}`)
        if (row.state.byteLength > config.maxProjectStateBytes)
          throw tooLarge('Project realtime state is too large')
        Y.applyUpdate(document, new Uint8Array(row.state))
        admissions.set(documentName, {
          mirror: new ProjectAdmission(
            document,
            db,
            projectId,
            config.maxProjectStateBytes
          ),
          lock: new Mutex(),
          retiring: new AbortController(),
        })
        return document
      } catch (error) {
        const reason =
          error &&
          typeof error === 'object' &&
          'statusCode' in error &&
          error.statusCode === 413
            ? FORCED_CLOSE_REASONS.stateTooLarge
            : FORCED_CLOSE_REASONS.invalidUpdate
        // createDocument coalesces loaders; every waiting logical provider
        // must release its reservation when the shared load fails.
        for (const [id, lease] of logicalLeases) {
          if (lease.documentName !== documentName || lease.active) continue
          releaseLease(id)
          sockets.get(lease.socketId)?.close(FORCED_CLOSE_CODE, reason)
        }
        throw error
      }
    },

    async onStoreDocument({ documentName, document }) {
      const projectId = projectIdOf(documentName)
      if (!projectId) return
      const admission = admissions.get(documentName)
      if (!admission) return
      await admission.lock.runExclusive(() => {
        const exists = db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .get()
        if (!exists) return // project was deleted while loaded
        const encoded = assertProjectStateWithinLimit(
          document,
          config.maxProjectStateBytes
        )
        admission.mirror.checkpoint(encoded)
        const state = Buffer.from(encoded)
        const updatedAt = Date.now()
        db.insert(projectYdocs)
          .values({ projectId, state, updatedAt })
          .onConflictDoUpdate({
            target: projectYdocs.projectId,
            set: { state, updatedAt },
          })
          .run()
      })
    },

    async onChange({ documentName, context }) {
      if (!context || context.system) return
      const projectId = projectIdOf(documentName)
      if (!projectId) return
      events.emit('changed', { projectId, userId: context.userId })
      const now = Date.now()
      if (now - (lastUpdatedAt.get(projectId) ?? 0) >= UPDATED_AT_THROTTLE_MS) {
        lastUpdatedAt.set(projectId, now)
        db.update(projects)
          .set({ updatedAt: now })
          .where(eq(projects.id, projectId))
          .run()
      }
    },

    async afterUnloadDocument({ documentName }) {
      const admission = admissions.get(documentName)
      admission?.retiring.abort({
        code: FORCED_CLOSE_CODE,
        reason: FORCED_CLOSE_REASONS.projectDeleted,
      })
      admission?.mirror.destroy()
      admissions.delete(documentName)
      const projectId = projectIdOf(documentName)
      if (projectId) lastUpdatedAt.delete(projectId)
    },
  })

  /**
   * Invokes `fn` synchronously inside a live Y transaction. Async callbacks pin
   * the document until their promise settles; work after await is NOT inside
   * that transaction and must use a nested helper for further Y mutations.
   */
  async function withProjectDoc<T>(
    projectId: string,
    fn: (doc: Y.Doc) => T | Promise<T>,
    context: ConnectionContext = { system: true }
  ): Promise<T> {
    const conn = await hocuspocus.openDirectConnection(
      projectDocumentName(projectId),
      context
    )
    try {
      let result!: T | Promise<T>
      await conn.transact(doc => {
        result = fn(doc)
      })
      return await result
    } finally {
      await conn.disconnect({ unloadImmediately: false })
    }
  }

  function broadcast(projectId: string, event: ProjectEvent) {
    hocuspocus.documents
      .get(projectDocumentName(projectId))
      ?.broadcastStateless(JSON.stringify(event))
  }

  /** End already-connected sessions as soon as HTTP logout/revocation commits. */
  function disconnectRevokedSessions() {
    // A protocol document close leaves the multiplexing WebSocket alive.
    // Revoke its upgrade principal as well, releasing the user's socket quota
    // even when a logged-out client deliberately keeps sending auth frames.
    for (const [id, socket] of sockets) {
      const session = db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, socket.sessionId),
            gt(sessions.expiresAt, Date.now())
          )
        )
        .get()
      if (session?.userId !== socket.userId) {
        socket.close(4401, 'Not logged in')
        closeSocket(id)
      }
    }
    for (const document of hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        try {
          authorize(connection)
        } catch (error) {
          const reason =
            error &&
            typeof error === 'object' &&
            'reason' in error &&
            typeof error.reason === 'string'
              ? error.reason
              : 'Not authorized'
          connection.close({ code: 4401, reason })
        }
      }
    }
  }

  function beginShutdown() {
    shuttingDown = true
    hocuspocus.closeConnections()
  }

  /** Persists every loaded document now (shutdown, tests). */
  async function flushAll() {
    if (shuttingDown)
      await Promise.allSettled(hocuspocus.loadingDocuments.values())
    await Promise.all(
      Array.from(connections, connection => connection.waitForPendingMessages())
    )
    const pending: Promise<unknown>[] = []
    for (const document of hocuspocus.documents.values()) {
      const id = `onStoreDocument-${document.name}`
      if (!document.isLoading && hocuspocus.debouncer.isDebounced(id)) {
        pending.push(Promise.resolve(hocuspocus.debouncer.executeNow(id)))
      }
    }
    await Promise.all(pending)
    // executeNow does not await stores already executing. The document's save
    // mutex does, so shutdown cannot close SQLite underneath a running store.
    await Promise.all(
      Array.from(hocuspocus.documents.values(), document =>
        document.saveMutex.runExclusive(() => {})
      )
    )
  }

  /**
   * Closes every client connection to the project's document with `reason`;
   * clients show a reload prompt instead of reconnecting.
   */
  function forceDisconnect(projectId: string, reason: ForcedCloseReason) {
    const document = hocuspocus.documents.get(projectDocumentName(projectId))
    for (const connection of document?.getConnections() ?? [])
      connection.close({ code: FORCED_CLOSE_CODE, reason })
  }

  /** Drains and unloads a project, then atomically removes its SQL state. */
  async function evict(projectId: string, removeRows: () => void) {
    retiringProjects.add(projectId)
    try {
      const name = projectDocumentName(projectId)
      admissions.get(name)?.retiring.abort({
        code: FORCED_CLOSE_CODE,
        reason: FORCED_CLOSE_REASONS.projectDeleted,
      })
      const pending = Array.from(connections)
        .filter(connection => connection.document.name === name)
        .map(connection => connection.waitForPendingMessages())
      forceDisconnect(projectId, FORCED_CLOSE_REASONS.projectDeleted)
      await Promise.all(pending)
      const document = hocuspocus.documents.get(name)
      if (document) {
        const id = `onStoreDocument-${name}`
        if (hocuspocus.debouncer.isDebounced(id))
          await hocuspocus.debouncer.executeNow(id)
        await document.saveMutex.runExclusive(() => {})
        await hocuspocus.unloadDocument(document)
      }
      // Keep the authorization guard until SQL removal is complete. Clearing
      // it before returning would allow a re-authentication microtask to load
      // the old row between eviction and the caller's DELETE.
      removeRows()
    } finally {
      retiringProjects.delete(projectId)
      lastUpdatedAt.delete(projectId)
    }
  }

  return {
    hocuspocus,
    events,
    withProjectDoc,
    broadcast,
    flushAll,
    evict,
    disconnectRevokedSessions,
    beginShutdown,
    openSocket,
    closeSocket,
  }
}
