import { createHash } from 'node:crypto'
import {
  mkdirSync, realpathSync
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  openSqliteDatabase, type SqliteDatabase
} from './sqlite-runtime'

const databaseRowSchema = z.object({
  name: z.string(),
  file: z.string()
})
const memoryOwnership = new WeakMap<SqliteDatabase, Set<string>>()

/** @riviere-role external-client-error */
class SqliteExclusiveLockError extends Error {
  constructor(key: string, cause: unknown) {
    super(`Unable to claim SQLite exclusive lock for ${key}: ${String(cause)}`, { cause })
    this.name = 'SqliteExclusiveLockError'
  }
}

function releaseOnce(release: () => void): () => void {
  const state = { released: false }
  return () => {
    if (state.released) return
    release()
    state.released = true
  }
}

function claimMemoryLock(db: SqliteDatabase, key: string): () => void {
  const owned = memoryOwnership.get(db) ?? new Set<string>()
  memoryOwnership.set(db, owned)
  if (owned.has(key)) throw new SqliteExclusiveLockError(key, 'Lock is already held.')
  owned.add(key)
  return releaseOnce(() => { owned.delete(key) })
}

/** @riviere-role external-client-service */
export function claimSqliteExclusiveLock(db: SqliteDatabase, key: string): () => void {
  z.string().min(1).parse(key)
  const databases = z.array(databaseRowSchema).parse(db.prepare('PRAGMA database_list').all())
  const file = databaseRowSchema.parse(databases.find(database => database.name === 'main')).file
  // Independent in-memory connections have independent databases. A shared
  // connection still needs exclusion between its callers.
  if (file === '') return claimMemoryLock(db, key)
  const directory = `${realpathSync(file)}.locks`
  mkdirSync(directory, { recursive: true })
  const digest = createHash('sha256').update(key).digest('hex')
  const lock = openSqliteDatabase(join(directory, `${digest}.db`))
  try {
    // Never wait synchronously for another asynchronous owner in this process.
    lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    lock.close()
    throw new SqliteExclusiveLockError(key, error)
  }
  // This separate database keeps the main database writable. Closing the
  // connection (including process exit) rolls back and releases the native lock.
  // Never unlink the file: that would allow another owner to lock a different inode.
  return releaseOnce(() => lock.close())
}
