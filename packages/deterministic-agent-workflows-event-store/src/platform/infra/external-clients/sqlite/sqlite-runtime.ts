import { createRequire } from 'node:module'

/** @riviere-role external-client-model */
export type SqliteStatement = {
  readonly all: (...params: readonly unknown[]) => readonly unknown[]
  readonly get: (...params: readonly unknown[]) => unknown | undefined
  readonly run: (...params: readonly unknown[]) => unknown
}

/** @riviere-role external-client-model */
export type SqliteDatabase = {
  readonly prepare: (sql: string) => SqliteStatement
  readonly exec: (sql: string) => void
  readonly close: () => void
}

type OpenOptions = { readonly readonly?: boolean }
type SqliteFactory = { readonly open: (path: string, options: OpenOptions) => SqliteDatabase }
type BunSqliteModule = { readonly Database: new (path: string, options?: { readonly?: boolean }) => SqliteDatabase }
type NodeSqliteModule = { readonly DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase }

const require = createRequire(import.meta.url)
const sqliteFactory: SqliteFactory = loadSqliteFactory()

/** @riviere-role external-client-service */
export function openSqliteDatabase(path: string, options: OpenOptions = {}): SqliteDatabase {
  return wrapSqliteDatabase(sqliteFactory.open(path, options))
}

/** @riviere-role external-client-service */
export function enableWalMode(database: SqliteDatabase): void {
  database.exec('PRAGMA journal_mode = WAL')
}

function loadSqliteFactory(): SqliteFactory {
  if (process.versions['bun'] !== undefined) {
    return loadBunSqliteFactory()
  }
  return loadNodeSqliteFactory()
}

function loadBunSqliteFactory(): SqliteFactory {
  const requiredModule: unknown = require('bun:sqlite')
  if (!isBunSqliteModule(requiredModule)) {
    throw new TypeError('bun:sqlite did not expose Database.')
  }

  return {
    open(path: string, options: OpenOptions): SqliteDatabase {
      return options.readonly === true
        ? new requiredModule.Database(path, { readonly: true })
        : new requiredModule.Database(path)
    },
  }
}

function loadNodeSqliteFactory(): SqliteFactory {
  const requiredModule: unknown = require('node:sqlite')
  if (!isNodeSqliteModule(requiredModule)) {
    throw new TypeError('node:sqlite did not expose DatabaseSync.')
  }

  return {
    open(path: string, options: OpenOptions): SqliteDatabase {
      return new requiredModule.DatabaseSync(path, { readOnly: options.readonly === true })
    },
  }
}

function wrapSqliteDatabase(db: SqliteDatabase): SqliteDatabase {
  return {
    prepare: (sql: string) => wrapSqliteStatement(db.prepare(sql)),
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
  }
}

function wrapSqliteStatement(statement: SqliteStatement): SqliteStatement {
  return {
    all: (...params: readonly unknown[]) => statement.all(...params),
    get: (...params: readonly unknown[]) => normalizeGetResult(statement.get(...params)),
    run: (...params: readonly unknown[]) => statement.run(...params),
  }
}

function normalizeGetResult(row: unknown): unknown | undefined {
  return row === null ? undefined : row
}

function isBunSqliteModule(value: unknown): value is BunSqliteModule {
  return typeof value === 'object' && value !== null && 'Database' in value
}

function isNodeSqliteModule(value: unknown): value is NodeSqliteModule {
  return typeof value === 'object' && value !== null && 'DatabaseSync' in value
}
