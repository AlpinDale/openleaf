import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/db/index.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

function dataDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openleaf-db-lifecycle-'))
  roots.push(root)
  return path.join(root, 'data')
}

describe('database lifecycle', () => {
  it('creates a private data directory and migrates the session expiry index', () => {
    const dir = dataDir()
    const db = openDb(dir)
    try {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
      expect(
        db.$client.pragma('index_info(sessions_expires_at_idx)')
      ).toMatchObject([{ name: 'expires_at' }])
    } finally {
      db.$client.close()
    }
  })

  it('does not chmod an existing operator-owned data directory', () => {
    const dir = dataDir()
    fs.mkdirSync(dir)
    fs.chmodSync(dir, 0o755)
    const db = openDb(dir)
    try {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o755)
    } finally {
      db.$client.close()
    }
  })

  it('closes the SQLite connection when initialization fails', () => {
    vi.spyOn(Database.prototype, 'pragma').mockImplementation(() => {
      throw new Error('simulated initialization failure')
    })
    const close = vi.spyOn(Database.prototype, 'close')
    expect(() => openDb(dataDir())).toThrow('simulated initialization failure')
    expect(close).toHaveBeenCalledOnce()
  })
})
