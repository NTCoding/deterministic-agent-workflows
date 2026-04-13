import type { ParsedEvent } from './query-types'
import { eventRowSchema } from './query-types'
import type { SqliteDatabase } from './sqlite-runtime'

/** @riviere-role query-model */
export type SessionQueryDeps = {readonly db: SqliteDatabase}

function parseEventRow(row: unknown): ParsedEvent {
  const validated = eventRowSchema.parse(row)
  const payload: unknown = JSON.parse(validated.payload)
  if (!isRecord(payload)) {
    throw new TypeError('Event payload must be an object.')
  }
  return {
    seq: validated.seq,
    sessionId: validated.session_id,
    type: validated.type,
    at: validated.at,
    payload,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getRows<T>(statementResult: readonly unknown[], parseRow: (row: unknown) => T): ReadonlyArray<T> {
  return statementResult.map(parseRow)
}

function getSingleRow<T>(row: unknown, parseRow: (value: unknown) => T): T {
  return parseRow(row)
}

function parseSessionIdRow(row: unknown): { readonly session_id: string } {
  if (!isRecord(row) || typeof row['session_id'] !== 'string') {
    throw new TypeError('Expected session_id row.')
  }
  return { session_id: row['session_id'] }
}

function parseCountRow(row: unknown): { readonly count: number } {
  if (!isRecord(row) || typeof row['count'] !== 'number') {
    throw new TypeError('Expected count row.')
  }
  return { count: row['count'] }
}

function parseMaxSeqRow(row: unknown): { readonly maxSeq: number | null } {
  if (!isRecord(row)) {
    throw new TypeError('Expected maxSeq row.')
  }
  const maxSeq = row['maxSeq']
  if (typeof maxSeq === 'number' || maxSeq === null) {
    return { maxSeq }
  }
  throw new TypeError('Expected numeric maxSeq row.')
}

/** @riviere-role query-model */
export function getDistinctSessionIds(deps: SessionQueryDeps): ReadonlyArray<string> {
  const rows = getRows(
    deps.db.prepare('SELECT DISTINCT session_id FROM events ORDER BY session_id').all(),
    parseSessionIdRow,
  )
  return rows.map((row) => row.session_id)
}

/** @riviere-role query-model */
export function getSessionEvents(
  deps: SessionQueryDeps,
  sessionId: string,
): ReadonlyArray<ParsedEvent> {
  const rows = getRows(
    deps.db.prepare('SELECT seq, session_id, type, at, payload FROM events WHERE session_id = ? ORDER BY seq').all(sessionId),
    (row) => eventRowSchema.parse(row),
  )
  return rows.map(parseEventRow)
}

/** @riviere-role query-model */
export function getSessionEventsPaginated(
  deps: SessionQueryDeps,
  sessionId: string,
  limit: number,
  offset: number,
  filters?: {
    readonly category?: string | undefined
    readonly type?: string | undefined
    readonly denied?: boolean | undefined
  },
): {
    readonly events: ReadonlyArray<ParsedEvent>;
    readonly total: number 
  } {
  const conditions = ['session_id = ?']
  const params: Array<string | number> = [sessionId]

  if (filters?.type) {
    conditions.push('type = ?')
    params.push(filters.type)
  }

  const whereClause = conditions.join(' AND ')

  const countRow = getSingleRow(
    deps.db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${whereClause}`).get(...params),
    parseCountRow,
  )

  const rows = getRows(
    deps.db
      .prepare(
        `SELECT seq, session_id, type, at, payload FROM events WHERE ${whereClause} ORDER BY seq LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset),
    (row) => eventRowSchema.parse(row),
  )

  return {
    events: rows.map(parseEventRow),
    total: countRow.count,
  }
}

/** @riviere-role query-model */
export function getMaxSeq(deps: SessionQueryDeps): number {
  const row = getSingleRow(deps.db.prepare('SELECT MAX(seq) as maxSeq FROM events').get(), parseMaxSeqRow)
  return row.maxSeq ?? 0
}

/** @riviere-role query-model */
export function getEventsSinceSeq(
  deps: SessionQueryDeps,
  sinceSeq: number,
): ReadonlyArray<ParsedEvent> {
  const rows = getRows(
    deps.db
      .prepare(
        'SELECT seq, session_id, type, at, payload FROM events WHERE seq > ? ORDER BY seq',
      )
      .all(sinceSeq),
    (row) => eventRowSchema.parse(row),
  )
  return rows.map(parseEventRow)
}

/** @riviere-role query-model */
export function getSessionCount(deps: SessionQueryDeps): number {
  const row = getSingleRow(
    deps.db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM events').get(),
    parseCountRow,
  )
  return row.count
}

/** @riviere-role query-model */
export function getTotalEventCount(deps: SessionQueryDeps): number {
  const row = getSingleRow(deps.db.prepare('SELECT COUNT(*) as count FROM events').get(), parseCountRow)
  return row.count
}
