import { Mutex } from 'async-mutex'

const locks = new Map<string, Mutex>()

/** Serialises tree/project mutations per project. */
export function projectLock(projectId: string): Mutex {
  let lock = locks.get(projectId)
  if (!lock) {
    lock = new Mutex()
    locks.set(projectId, lock)
  }
  return lock
}
