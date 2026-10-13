import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.OPENLEAF_E2E_PORT ?? 3100)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('OPENLEAF_E2E_PORT must be an integer from 1 to 65535')
}
const baseURL = `http://127.0.0.1:${PORT}`
const repoRoot = path.resolve(import.meta.dirname, '..')

// A fresh data directory per run; the server (host compile runner) serves the
// production web build.
const providedDataDir = process.env.OPENLEAF_E2E_DATA_DIR
const dataDir = providedDataDir
  ? path.resolve(repoRoot, providedDataDir)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'openleaf-e2e-'))
process.env.OPENLEAF_E2E_DATA_DIR = dataDir

export default defineConfig({
  metadata: {
    openleafTemporaryDataDir: providedDataDir ? null : dataDir,
  },
  testDir: './specs',
  globalTeardown: './global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1500, height: 950 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1500, height: 950 },
      },
    },
  ],
  webServer: {
    command:
      'pnpm -r --filter @openleaf/server... --filter @openleaf/web build && node apps/server/dist/index.js',
    cwd: repoRoot,
    // Ready once /api/auth/me answers (401 counts as up).
    url: `${baseURL}/api/auth/me`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      OPENLEAF_DATA_DIR: dataDir,
      OPENLEAF_PORT: String(PORT),
      OPENLEAF_HOST: '127.0.0.1',
      OPENLEAF_PUBLIC_URL: baseURL,
      OPENLEAF_WEB_DIST: path.join(repoRoot, 'apps/web/dist'),
      OPENLEAF_COMPILE_RUNNER: 'host',
    },
  },
})
