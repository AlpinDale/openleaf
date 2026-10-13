import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSpellLanguage } from '@openleaf/shared'
import type { FastifyInstance } from 'fastify'
import { notFound } from '../errors.js'
import { sendFile } from '../util/send-file.js'

const FILE_RE = /^([A-Za-z_]+)\.(aff|dic)$/

/** `GET /dictionaries/<lang>.(aff|dic)` from the wooorm dictionary-* packages. */
export async function dictionaryRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>(
    '/dictionaries/:file',
    async (request, reply) => {
      const match = FILE_RE.exec(request.params.file)
      const language = match ? findSpellLanguage(match[1]) : undefined
      if (!match || !language) throw notFound('Unknown dictionary')
      // The packages only export ./index.js, so locate the files next to it.
      const dir = path.dirname(fileURLToPath(import.meta.resolve(language.pkg)))
      return sendFile(reply, `index.${match[2]}`, dir, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      })
    }
  )
}
