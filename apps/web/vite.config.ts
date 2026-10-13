import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { compile, grammars } from './scripts/generate-grammars.mjs'

function lezerGrammars(): Plugin {
  return {
    name: 'openleaf-lezer-grammars',
    configureServer(server) {
      for (const grammar of grammars) server.watcher.add(grammar.grammarPath)
      server.watcher.on('change', file => {
        const grammar = grammars.find(
          (g: { grammarPath: string }) => g.grammarPath === file
        )
        if (!grammar) return
        try {
          compile(grammar, { force: true })
        } catch (err) {
          server.config.logger.error(String(err))
        }
      })
    },
  }
}

// OPENLEAF_API_PORT lets several dev pairs (web + API) run side by side.
const apiPort = process.env.OPENLEAF_API_PORT ?? '3000'
const backend = `http://127.0.0.1:${apiPort}`

export default defineConfig({
  plugins: [react(), lezerGrammars()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@ol-types': path.resolve(import.meta.dirname, 'src/types'),
      // Bundle the workspace package from source so `vite build` doesn't
      // depend on `packages/shared` having been compiled first.
      '@openleaf/shared': path.resolve(
        import.meta.dirname,
        '../../packages/shared/src/index.ts'
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/git': backend,
      '/dictionaries': backend,
      '/vendor': backend,
      '/collab': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
  worker: { format: 'es' },
  css: {
    preprocessorOptions: {
      scss: {
        // Ported Overleaf/Bootstrap SCSS still uses @import and global builtins.
        quietDeps: true,
        silenceDeprecations: [
          'import',
          'global-builtin',
          'color-functions',
          'if-function',
        ],
      },
    },
  },
})
