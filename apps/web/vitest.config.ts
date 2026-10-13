import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@ol-types': path.resolve(import.meta.dirname, 'src/types'),
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
