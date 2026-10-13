import fs from 'node:fs'

import { badRequest } from '../errors.js'

const PATH_MAX_BYTES = process.platform === 'darwin' ? 1024 : 4096
const COMPILE_KEY_BYTES = 36 * 2 + 1 // project UUID + '-' + user UUID
const COMPILE_PREFIX_BYTES = '/compiles/'.length + COMPILE_KEY_BYTES + 1

/** Reserves the real materialization prefix and the native path terminator. */
export function assertMaterializablePath(
  dataDir: string,
  relativePath: string
) {
  const root =
    process.platform === 'darwin' ? fs.realpathSync.native(dataDir) : dataDir
  const rootBytes = Buffer.byteLength(root) - (root.endsWith('/') ? 1 : 0)
  const bytes =
    rootBytes + COMPILE_PREFIX_BYTES + Buffer.byteLength(relativePath)
  if (bytes >= PATH_MAX_BYTES)
    throw badRequest('File path is too long for the server filesystem')
}
