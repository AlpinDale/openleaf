import { EventEmitter } from 'node:events'

export type ProjectChangedEvent = { projectId: string; userId: string | null }

type Events = { changed: [ProjectChangedEvent] }

/**
 * Per-app emitter (on `ctx.realtime.events`): `changed` fires after every
 * content change; history marks projects dirty from it.
 */
export type ProjectEvents = EventEmitter<Events>

export const createProjectEvents = (): ProjectEvents =>
  new EventEmitter<Events>()
