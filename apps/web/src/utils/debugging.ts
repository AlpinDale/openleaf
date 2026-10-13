function enabled() {
  try {
    return localStorage.getItem('debug') === 'true'
  } catch {
    return false
  }
}

export const debugConsole = {
  log: (...args: unknown[]) => {
    if (enabled()) console.log(...args)
  },
  debug: (...args: unknown[]) => {
    if (enabled()) console.debug(...args)
  },
  warn: (...args: unknown[]) => {
    if (enabled()) console.warn(...args)
  },
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}
