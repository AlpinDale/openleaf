import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/** Self-hosted MathJax (no CDN). */
export async function vendorRoutes(app: FastifyInstance) {
  for (const [prefix, pkg] of [
    ['/vendor/mathjax/', 'mathjax'],
    ['/vendor/mathjax-newcm-font/', '@mathjax/mathjax-newcm-font'],
  ] as const) {
    await app.register(fastifyStatic, {
      root: path.dirname(
        fileURLToPath(import.meta.resolve(`${pkg}/package.json`))
      ),
      prefix,
      decorateReply: false,
      maxAge: '1d',
    })
  }
}

/** The built web app's directory, when `OPENLEAF_WEB_DIST` holds a build. */
export function webDistRoot(webDist: string): string | null {
  return fs.existsSync(path.join(webDist, 'index.html')) ? webDist : null
}

/** Serves the built SPA; hashed assets are cached forever, everything else revalidates. */
export async function webRoutes(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: false,
    index: false,
    // One route per built file; everything else falls through to the SPA fallback.
    wildcard: false,
    setHeaders(res, filePath) {
      res.header(
        'cache-control',
        filePath.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache'
      )
    },
  })
}
