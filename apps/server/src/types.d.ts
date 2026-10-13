import type { Role } from '@openleaf/shared'
import type { AppContext } from './context.js'
import type { schema } from './db/index.js'

export type RequestUser = { id: string; email: string; name: string }
export type ProjectRow = typeof schema.projects.$inferSelect

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
  interface FastifyRequest {
    user: RequestUser | null
    sessionId: string | null
    project: ProjectRow
    role: Role
  }
}
