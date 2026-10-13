import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: { testTimeout: 30000, hookTimeout: 30000 },
})
