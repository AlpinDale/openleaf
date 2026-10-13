/** Overleaf's Sentry reporter; OpenLeaf only logs. */
export function captureException(err: unknown, context?: unknown) {
  console.error(err, context)
}
