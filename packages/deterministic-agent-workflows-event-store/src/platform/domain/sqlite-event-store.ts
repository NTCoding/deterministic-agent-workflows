import { z } from 'zod'
import type { StoredEvent } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  stripEnvelopeKeys,
  WorkflowStateError,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  enableWalMode,
  openSqliteDatabase,
  type SqliteDatabase,
} from '../infra/external-clients/sqlite/sqlite-runtime'

const createTableSql = `
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    state TEXT,
    payload TEXT NOT NULL
  )
`

const eventRowSchema = z.array(z.object({
  type: z.string(),
  at: z.string(),
  state: z.string().nullable(),
  payload: z.string(),
}))
const rowWithSessionIdSchema = z.array(z.object({ session_id: z.string() }))
const countFieldSchema = z.union([z.number(), z.bigint(), z.string()])
const countRowSchema = z.object({ count: countFieldSchema })
const tableInfoRowSchema = z.array(z.object({ name: z.string() }))

/** @riviere-role value-object */
export type SqliteEventStore = {
  readonly readEvents: (sessionId: string) => readonly StoredEvent[]
  readonly appendEvents: (sessionId: string, events: readonly StoredEvent[]) => void
  readonly sessionExists: (sessionId: string) => boolean
  readonly hasSessionStarted: (sessionId: string) => boolean
  readonly listSessions: () => readonly string[]
  readonly db: SqliteDatabase
}

/** @riviere-role domain-service */
export function createStore(dbPath: string): SqliteEventStore {
  const db = openSqliteDatabase(dbPath)
  enableWalMode(db)
  db.exec(createTableSql)
  ensureStateColumn(db)

  return {
    db,
    readEvents(sessionId: string): readonly StoredEvent[] {
      const rawRows = db.prepare('SELECT type, at, state, payload FROM events WHERE session_id = ? ORDER BY seq').all(sessionId)
      const rows = eventRowSchema.parse(rawRows)
      return rows.map((row, index) => buildStoredEvent(row, sessionId, index))
    },
    appendEvents(sessionId: string, events: readonly StoredEvent[]): void {
      if (events.length === 0) return

      const insert = db.prepare('INSERT INTO events (session_id, type, at, state, payload) VALUES (?, ?, ?, ?, ?)')
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const event of events) {
          insert.run(
            sessionId,
            event.envelope.type,
            event.envelope.at,
            event.envelope.state ?? null,
            JSON.stringify(event.payload),
          )
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    sessionExists(sessionId: string): boolean {
      return readCount(db, 'SELECT COUNT(1) AS count FROM events WHERE session_id = ?', sessionId) > 0
    },
    hasSessionStarted(sessionId: string): boolean {
      return readCount(
        db,
        "SELECT COUNT(1) AS count FROM events WHERE session_id = ? AND type = 'session-started'",
        sessionId,
      ) > 0
    },
    listSessions(): readonly string[] {
      const rawRows = db.prepare('SELECT session_id FROM events GROUP BY session_id ORDER BY MIN(seq)').all()
      return rowWithSessionIdSchema.parse(rawRows).map((row) => row.session_id)
    },
  }
}

function readCount(db: SqliteDatabase, query: string, sessionId: string): number {
  const rawRow = db.prepare(query).get(sessionId)
  if (rawRow === undefined || rawRow === null) return 0

  const parsed = countRowSchema.safeParse(rawRow)
  if (!parsed.success) {
    throw new WorkflowStateError(`Invalid count query row for session ${sessionId}: ${parsed.error.message}`)
  }

  const normalized = Number(parsed.data.count)
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new WorkflowStateError(`Invalid count value for session ${sessionId}: ${String(parsed.data.count)}`)
  }
  return normalized
}

/** @riviere-role domain-service */
export function resolveSessionId(store: SqliteEventStore, input: string): string {
  if (store.sessionExists(input)) return input

  const prefixMatches = store.listSessions().filter((session) => session.startsWith(input))
  const singleMatch = prefixMatches.length === 1 ? prefixMatches[0] : undefined
  if (singleMatch !== undefined) return singleMatch

  if (prefixMatches.length > 1) {
    const matches = prefixMatches.map((session) => `  ${session}`).join('\n')
    throw new WorkflowStateError(`Ambiguous session prefix "${input}". Matches:\n${matches}`)
  }

  throw new WorkflowStateError(
    `No events found for session "${input}". Run "analyze --all" to list available sessions.`,
  )
}

function tryParsePayload(payload: string, index: number): unknown {
  try {
    return JSON.parse(payload)
  } catch (cause) {
    throw new WorkflowStateError(`Cannot parse event payload at index ${index}: ${String(cause)}`)
  }
}

function ensureStateColumn(db: SqliteDatabase): void {
  const rawColumns = db.prepare('PRAGMA table_info(events)').all()
  const columns = tableInfoRowSchema.parse(rawColumns)
  if (columns.some((column) => column.name === 'state')) return
  db.exec('ALTER TABLE events ADD COLUMN state TEXT')
}

type EventRow = {
  readonly type: string
  readonly at: string
  readonly state: string | null
  readonly payload: string
}

/**
 * Dual-read adapter. Modern rows carry only domain fields in `payload` JSON
 * (envelope in columns). Legacy rows have `type`/`at` duplicated inside the
 * payload JSON and no `state` column value. Either way, normalize to
 * `StoredEvent` with undefined state for legacy rows.
 */
function buildStoredEvent(row: EventRow, sessionId: string, index: number): StoredEvent {
  const parsedPayload = tryParsePayload(row.payload, index)
  if (!isRecord(parsedPayload)) {
    throw new WorkflowStateError(
      `Invalid event payload at index ${index} for session ${sessionId}: expected object`,
    )
  }
  return {
    envelope: {
      type: row.type,
      at: row.at,
      state: row.state ?? undefined,
    },
    payload: stripEnvelopeKeys(parsedPayload),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
