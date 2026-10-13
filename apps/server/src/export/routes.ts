import { EXPORT_FORMATS } from '@openleaf/shared'
import type { FastifyInstance } from 'fastify'
import { requireProjectRole } from '../auth/plugin.js'
import { attachmentHeader } from '../projects/zip.js'
import { EXPORT_CONTENT_TYPES } from './service.js'

export async function exportRoutes(app: FastifyInstance) {
  const ctx = app.ctx
  for (const format of EXPORT_FORMATS) {
    app.get(
      `/projects/:id/export.${format}`,
      { preHandler: requireProjectRole('viewer') },
      async (request, reply) => {
        const body = await ctx.exports.export(request.project, format)
        const base = request.project.name.replace(/[/\\:*?"<>|]/g, '_')
        return reply
          .header('content-type', EXPORT_CONTENT_TYPES[format])
          .header('content-disposition', attachmentHeader(`${base}.${format}`))
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'no-store')
          .send(body)
      }
    )
  }

  app.get('/config', async () => ({
    exports: await ctx.exports.available(),
    supportUrl: ctx.config.supportUrl,
  }))
}
