import { z } from 'zod'
import type {
  ListedReview,
  RecordReviewInput,
  RecordReflectionInput,
  ReviewFilters,
  StoredEvent,
  StoredReflection,
  StoredReview,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  recordReviewInputSchema,
  recordReflectionInputSchema,
  storedReflectionSchema,
  storedReviewSchema,
  stripEnvelopeKeys,
  WorkflowStateError,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  enableWalMode,
  openSqliteDatabase,
  type SqliteDatabase,
} from '../infra/external-clients/sqlite/sqlite-runtime'
import {
  buildReviewFilters,
  createReviewsBranchIndexSql,
  createReviewsPullRequestIndexSql,
  createReviewsSessionIndexSql,
  createReviewsTableSql,
  createReviewsTypeVerdictIndexSql,
  listedReviewRowsSchema,
  parseListedReviewRow,
  parseStoredReviewRow,
  reviewIdRowSchema,
  reviewRowsSchema,
} from './sqlite-review-storage'

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

const createReflectionsTableSql = `
  CREATE TABLE IF NOT EXISTS reflections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    label TEXT,
    agent_name TEXT,
    source_state TEXT,
    payload_json TEXT NOT NULL
  )
`

const createReflectionsIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_reflections_session_created_at
  ON reflections (session_id, created_at DESC, id DESC)
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
const reflectionIdRowSchema = z.object({ id: countFieldSchema })
const reflectionRowsSchema = z.array(z.object({
  id: z.number(),
  session_id: z.string(),
  created_at: z.string(),
  label: z.string().nullable(),
  agent_name: z.string().nullable(),
  source_state: z.string().nullable(),
  payload_json: z.string(),
}))

/** @riviere-role value-object */
export type SqliteEventStore = {
  readonly readEvents: (sessionId: string) => readonly StoredEvent[]
  readonly appendEvents: (sessionId: string, events: readonly StoredEvent[]) => void
  readonly sessionExists: (sessionId: string) => boolean
  readonly hasSessionStarted: (sessionId: string) => boolean
  readonly recordReflection: (sessionId: string, createdAt: string, input: RecordReflectionInput) => StoredReflection
  readonly listReflections: (sessionId: string) => readonly StoredReflection[]
  readonly recordReview: (sessionId: string, createdAt: string, input: RecordReviewInput) => StoredReview
  readonly listSessionReviews: (sessionId: string) => readonly StoredReview[]
  readonly listReviews: (filters: ReviewFilters) => readonly ListedReview[]
  readonly listSessions: () => readonly string[]
  readonly db: SqliteDatabase
}

/** @riviere-role domain-service */
export function createStore(dbPath: string): SqliteEventStore {
  const db = openSqliteDatabase(dbPath)
  enableWalMode(db)
  db.exec(createTableSql)
  db.exec(createReflectionsTableSql)
  db.exec(createReflectionsIndexSql)
  db.exec(createReviewsTableSql)
  db.exec(createReviewsSessionIndexSql)
  db.exec(createReviewsTypeVerdictIndexSql)
  db.exec(createReviewsBranchIndexSql)
  db.exec(createReviewsPullRequestIndexSql)
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
    recordReflection(sessionId: string, createdAt: string, input: RecordReflectionInput): StoredReflection {
      const parsedInput = recordReflectionInputSchema.parse(input)
      const insert = db.prepare('INSERT INTO reflections (session_id, created_at, label, agent_name, source_state, payload_json) VALUES (?, ?, ?, ?, ?, ?)')
      db.exec('BEGIN IMMEDIATE')
      try {
        insert.run(
          sessionId,
          createdAt,
          parsedInput.label ?? null,
          parsedInput.agentName ?? null,
          parsedInput.sourceState ?? null,
          JSON.stringify(parsedInput.reflection),
        )
        const rawId = db.prepare('SELECT last_insert_rowid() AS id').get()
        const parsedId = reflectionIdRowSchema.parse(rawId)
        const id = Number(parsedId.id)
        db.exec('COMMIT')
        return storedReflectionSchema.parse({
          id,
          sessionId,
          createdAt,
          ...(parsedInput.label === undefined ? {} : { label: parsedInput.label }),
          ...(parsedInput.agentName === undefined ? {} : { agentName: parsedInput.agentName }),
          ...(parsedInput.sourceState === undefined ? {} : { sourceState: parsedInput.sourceState }),
          reflection: parsedInput.reflection,
        })
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    listReflections(sessionId: string): readonly StoredReflection[] {
      const rawRows = db.prepare('SELECT id, session_id, created_at, label, agent_name, source_state, payload_json FROM reflections WHERE session_id = ? ORDER BY created_at DESC, id DESC').all(sessionId)
      const rows = reflectionRowsSchema.parse(rawRows)
      return rows.map((row) => {
        const reflectionPayload: unknown = JSON.parse(row.payload_json)
        return storedReflectionSchema.parse({
          id: row.id,
          sessionId: row.session_id,
          createdAt: row.created_at,
          ...(row.label === null ? {} : { label: row.label }),
          ...(row.agent_name === null ? {} : { agentName: row.agent_name }),
          ...(row.source_state === null ? {} : { sourceState: row.source_state }),
          reflection: reflectionPayload,
        })
      })
    },
    recordReview(sessionId: string, createdAt: string, input: RecordReviewInput): StoredReview {
      const parsedInput = recordReviewInputSchema.parse(input)
      const insert = db.prepare('INSERT INTO reviews (session_id, created_at, review_type, verdict, branch, pull_request_number, source_state, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      db.exec('BEGIN IMMEDIATE')
      try {
        insert.run(
          sessionId,
          createdAt,
          parsedInput.reviewType,
          parsedInput.verdict,
          parsedInput.branch ?? null,
          parsedInput.pullRequestNumber ?? null,
          parsedInput.sourceState ?? null,
          JSON.stringify(parsedInput),
        )
        const rawId = db.prepare('SELECT last_insert_rowid() AS id').get()
        const parsedId = reviewIdRowSchema.parse(rawId)
        const id = Number(parsedId.id)
        db.exec('COMMIT')
        return storedReviewSchema.parse({
          id,
          sessionId,
          createdAt,
          ...parsedInput,
        })
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    listSessionReviews(sessionId: string): readonly StoredReview[] {
      const rawRows = db.prepare('SELECT id, session_id, created_at, review_type, verdict, branch, pull_request_number, source_state, payload_json FROM reviews WHERE session_id = ? ORDER BY created_at ASC, id ASC').all(sessionId)
      const rows = reviewRowsSchema.parse(rawRows)
      return rows.map(parseStoredReviewRow)
    },
    listReviews(filters: ReviewFilters): readonly ListedReview[] {
      const parsedFilters = buildReviewFilters(filters)
      const whereClause = parsedFilters.conditions.length === 0
        ? ''
        : `WHERE ${parsedFilters.conditions.join(' AND ')}`
      const rawRows = db.prepare(`
        SELECT
          reviews.id,
          reviews.session_id,
          reviews.created_at,
          reviews.review_type,
          reviews.verdict,
          reviews.branch,
          reviews.pull_request_number,
          reviews.source_state,
          reviews.payload_json,
          (
            SELECT json_extract(events.payload, '$.repository')
            FROM events
            WHERE events.session_id = reviews.session_id AND events.type = 'session-started'
            ORDER BY events.seq ASC
            LIMIT 1
          ) AS repository
        FROM reviews
        ${whereClause}
        ORDER BY reviews.created_at DESC, reviews.id DESC
      `).all(...parsedFilters.parameters)
      const rows = listedReviewRowsSchema.parse(rawRows)
      return rows.map(parseListedReviewRow)
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
