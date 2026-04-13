import { z } from 'zod'
import { WorkflowStateError } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  enableWalMode,
  openSqliteDatabase,
  type SqliteDatabase,
} from '../infra/external-clients/sqlite/sqlite-runtime'

const passthroughEventSchema = z.object({
  type: z.string(),
  at: z.string(),
}).passthrough()

type BaseEvent = z.infer<typeof passthroughEventSchema>

const createTableSql = `
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`

const rowWithPayloadSchema = z.array(z.object({ payload: z.string() }))
const rowWithSessionIdSchema = z.array(z.object({ session_id: z.string() }))
const countFieldSchema = z.union([z.number(), z.bigint(), z.string()])
const countRowSchema = z.object({ count: countFieldSchema })

/** @riviere-role value-object */
export type SqliteEventStore = {
  readonly readEvents: (sessionId: string) => readonly BaseEvent[]
  readonly appendEvents: (sessionId: string, events: readonly BaseEvent[]) => void
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

  return {
    db,
    readEvents(sessionId: string): readonly BaseEvent[] {
      const rawRows = db.prepare('SELECT payload FROM events WHERE session_id = ? ORDER BY seq').all(sessionId)
      const rows = rowWithPayloadSchema.parse(rawRows)
      return rows.map((row, index) => {
        const parsedPayload = tryParsePayload(row.payload, index)
        const parsedEvent = passthroughEventSchema.safeParse(parsedPayload)
        if (!parsedEvent.success) {
          throw new WorkflowStateError(
            `Invalid event at index ${index} for session ${sessionId}: ${parsedEvent.error.message}`,
          )
        }
        return parsedEvent.data
      })
    },
    appendEvents(sessionId: string, events: readonly BaseEvent[]): void {
      if (events.length === 0) return

      const insert = db.prepare('INSERT INTO events (session_id, type, at, payload) VALUES (?, ?, ?, ?)')
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const event of events) {
          insert.run(sessionId, event.type, event.at, JSON.stringify(event))
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
