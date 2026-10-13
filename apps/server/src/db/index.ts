import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database
}

const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle')

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const sqlite = new Database(path.join(dataDir, 'openleaf.db'))
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder })
    return db
  } catch (err) {
    sqlite.close()
    throw err
  }
}

export { schema }
