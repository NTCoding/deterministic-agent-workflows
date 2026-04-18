import type { ParsedEvent } from './query-types'
import { eventRowSchema } from './query-types'
import {
  storedReflectionSchema,
  type StoredReflection,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { SqliteDatabase } from './sqlite-runtime'

/** @riviere-role query-model */
export type SessionQueryDeps = {readonly db: SqliteDatabase}

const stateColumnCache = new WeakMap<SqliteDatabase, boolean>()
const reflectionsTableCache = new WeakMap<SqliteDatabase, boolean>()

function hasStateColumn(db: SqliteDatabase): boolean {
  const cached = stateColumnCache.get(db)
  if (cached !== undefined) return cached
  const rows = db.prepare('PRAGMA table_info(events)').all()
  const has = rows.some((row) => isRecord(row) && row['name'] === 'state')
  stateColumnCache.set(db, has)
  return has
}

function hasReflectionsTable(db: SqliteDatabase): boolean {
  const cached = reflectionsTableCache.get(db)
  if (cached !== undefined) return cached
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reflections'").all()
  const has = rows.some((row) => isRecord(row) && row['name'] === 'reflections')
  reflectionsTableCache.set(db, has)
  return has
}

function stateProjection(db: SqliteDatabase): string {
  return hasStateColumn(db) ? 'state' : 'NULL as state'
}

function parseEventRow(row: unknown): ParsedEvent {
  const validated = eventRowSchema.parse(row)
  const payload: unknown = JSON.parse(validated.payload)
  if (!isRecord(payload)) {
    throw new TypeError('Event payload must be an object.')
  }
  const base = {
    seq: validated.seq,
    sessionId: validated.session_id,
    type: validated.type,
    at: validated.at,
    payload: stripEnvelopeKeys(payload),
  }
  return validated.state === null ? base : {
    ...base,
    state: validated.state,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stripEnvelopeKeys(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'type' || key === 'at') continue
    result[key] = value
  }
  return result
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

function parseTranscriptPath(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }
  const transcriptPath = value['transcriptPath']
  return typeof transcriptPath === 'string' ? transcriptPath : null
}

function parseTranscriptPayloadRow(row: unknown): { readonly payload: string } {
  if (!isRecord(row) || typeof row['payload'] !== 'string') {
    throw new TypeError('Expected transcript payload row.')
  }
  return {payload: row['payload'],}
}

function parseReflectionRow(row: unknown): StoredReflection {
  if (!isRecord(row)) {
    throw new TypeError('Expected reflection row.')
  }
  const payload = row['payload_json']
  if (typeof payload !== 'string') {
    throw new TypeError('Expected reflection payload_json string.')
  }
  const parsedPayload: unknown = JSON.parse(payload)
  return storedReflectionSchema.parse({
    id: row['id'],
    sessionId: row['session_id'],
    createdAt: row['created_at'],
    ...(typeof row['label'] === 'string' ? { label: row['label'] } : {}),
    ...(typeof row['agent_name'] === 'string' ? { agentName: row['agent_name'] } : {}),
    ...(typeof row['source_state'] === 'string' ? { sourceState: row['source_state'] } : {}),
    reflection: parsedPayload,
  })
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
    deps.db.prepare(`SELECT seq, session_id, type, at, ${stateProjection(deps.db)}, payload FROM events WHERE session_id = ? ORDER BY seq`).all(sessionId),
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
        `SELECT seq, session_id, type, at, ${stateProjection(deps.db)}, payload FROM events WHERE ${whereClause} ORDER BY seq LIMIT ? OFFSET ?`,
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
        `SELECT seq, session_id, type, at, ${stateProjection(deps.db)}, payload FROM events WHERE seq > ? ORDER BY seq`,
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
export function getSessionReflections(
  deps: SessionQueryDeps,
  sessionId: string,
): ReadonlyArray<StoredReflection> {
  if (!hasReflectionsTable(deps.db)) return []
  const rows = deps.db
    .prepare('SELECT id, session_id, created_at, label, agent_name, source_state, payload_json FROM reflections WHERE session_id = ? ORDER BY created_at DESC, id DESC')
    .all(sessionId)
  return getRows(rows, parseReflectionRow)
}

/** @riviere-role query-model */
export function getTotalEventCount(deps: SessionQueryDeps): number {
  const row = getSingleRow(deps.db.prepare('SELECT COUNT(*) as count FROM events').get(), parseCountRow)
  return row.count
}

/** @riviere-role query-model */
export function getTranscriptPath(deps: SessionQueryDeps, sessionId: string): string | null {
  const raw = deps.db
    .prepare("SELECT payload FROM events WHERE session_id = ? AND type = 'session-started' ORDER BY seq ASC LIMIT 1")
    .get(sessionId)
  if (raw === undefined || raw === null) return null
  const row = parseTranscriptPayloadRow(raw)
  const payload: unknown = JSON.parse(row.payload)
  return parseTranscriptPath(payload)
}

/** @riviere-role query-model */
export function getInitialState(deps: SessionQueryDeps, sessionId: string): {
  readonly state: string;
  readonly startedAt: string 
} | null {
  const raw = deps.db
    .prepare("SELECT at, payload FROM events WHERE session_id = ? AND type = 'session-started' ORDER BY seq ASC LIMIT 1")
    .get(sessionId)
  if (raw === undefined || raw === null) return null
  const row = raw
  if (!isRecord(row)) return null
  const payload: unknown = typeof row['payload'] === 'string' ? JSON.parse(row['payload']) : null
  if (!isRecord(payload)) return null
  const currentState = payload['currentState']
  if (typeof currentState !== 'string' || currentState.length === 0) return null
  return {
    state: currentState,
    startedAt: resolveStartedAt(row, payload),
  }
}

function resolveStartedAt(row: Record<string, unknown>, payload: Record<string, unknown>): string {
  if (typeof row['at'] === 'string') return row['at']
  if (typeof payload['at'] === 'string') return payload['at']
  return ''
}
