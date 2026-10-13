import { notFound } from '../errors.js'

/** Abandon a queued acquisition without cancelling other users of the mutex. */
export async function acquireUntilClosed(
  pending: Promise<() => void>,
  signal: AbortSignal,
  onAbandoned: (ticket: Promise<void>) => void
) {
  const admitted = Promise.withResolvers<() => void>()
  const cleaned = Promise.withResolvers<void>()
  let abandoned = false
  const abort = () => {
    abandoned = true
    admitted.reject(notFound('Project is no longer available'))
    onAbandoned(cleaned.promise)
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  void pending.then(
    release => {
      if (abandoned) release()
      else admitted.resolve(release)
      cleaned.resolve()
    },
    err => {
      admitted.reject(err)
      cleaned.resolve()
    }
  )
  try {
    const release = await admitted.promise
    if (signal.aborted) {
      release()
      throw notFound('Project is no longer available')
    }
    return release
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
