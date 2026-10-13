import fs from 'node:fs'
import type { FullConfig } from '@playwright/test'

/** Only remove a directory allocated by this run, never user-supplied data. */
export default function globalTeardown(config: FullConfig) {
  const dir: unknown = config.metadata.openleafTemporaryDataDir
  if (typeof dir === 'string') {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
