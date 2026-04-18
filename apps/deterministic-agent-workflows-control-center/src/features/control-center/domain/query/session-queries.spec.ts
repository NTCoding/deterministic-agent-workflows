import {
  describe, it, expect, beforeEach 
} from 'vitest'
import {
  getDistinctSessionIds,
  getSessionEvents,
  getSessionEventsPaginated,
  getMaxSeq,
  getEventsSinceSeq,
  getSessionCount,
  getSessionReflections,
  getTotalEventCount,
  getTranscriptPath,
  getInitialState,
} from './session-queries'
import {
  createTestDb,
  createTestQueryDeps,
  insertEvent,
  insertReflection,
  seedSessionEvents,
  seedMultipleSessions,
} from './session-queries-test-fixtures'
import type { SqliteDatabase } from './sqlite-runtime'
import { openSqliteDatabase } from './sqlite-runtime'
import { createSafeTempDir } from '../../infra/web/server/http-test-fixtures'

function createBrokenDeps(getValue: unknown): { readonly db: SqliteDatabase } {
  return {
    db: {
      prepare: () => ({
        all: () => [],
        get: () => getValue,
        run: () => undefined,
      }),
      exec: () => undefined,
      close: () => undefined,
    },
  }
}

function createCustomDeps(rows: ReadonlyArray<unknown>): { readonly db: SqliteDatabase } {
  return {
    db: {
      prepare: () => ({
        all: () => rows,
        get: () => rows[0],
        run: () => undefined,
      }),
      exec: () => undefined,
      close: () => undefined,
    },
  }
}

function createReflectionDeps(reflectionRows: ReadonlyArray<unknown>): { readonly db: SqliteDatabase } {
  return {
    db: {
      prepare: (sql: string) => ({
        all: () => sql.includes('sqlite_master') ? [{ name: 'reflections' }] : reflectionRows,
        get: () => undefined,
        run: () => undefined,
      }),
      exec: () => undefined,
      close: () => undefined,
    },
  }
}

describe('session-queries', () => {
  const state: {db: SqliteDatabase} = {db: createTestDb(),}

  beforeEach(() => {
    state.db = createTestDb()
  })

  describe('getDistinctSessionIds', () => {
    it('returns empty array for empty database', () => {
      expect(getDistinctSessionIds(createTestQueryDeps(state.db))).toStrictEqual([])
    })

    it('returns distinct session IDs', () => {
      seedMultipleSessions(state.db)
      const ids = getDistinctSessionIds(createTestQueryDeps(state.db))
      expect(ids).toHaveLength(2)
      expect(ids).toContain('session-a')
      expect(ids).toContain('session-b')
    })

    it('throws for malformed distinct session rows', () => {
      expect(() => getDistinctSessionIds(createCustomDeps([{}]))).toThrow('Expected session_id row.')
    })
  })

  describe('getSessionEvents', () => {
    it('returns empty array for unknown session', () => {
      expect(getSessionEvents(createTestQueryDeps(state.db), 'nonexistent')).toStrictEqual([])
    })

    it('returns events in order for a session', () => {
      seedSessionEvents(state.db, 'test-1')
      const events = getSessionEvents(createTestQueryDeps(state.db), 'test-1')
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]?.type).toBe('session-started')
      expect(events[0]?.sessionId).toBe('test-1')
    })

    it('parses payload JSON correctly', () => {
      seedSessionEvents(state.db, 'test-1')
      const events = getSessionEvents(createTestQueryDeps(state.db), 'test-1')
      const started = events[0]
      expect(started?.payload['repository']).toBe('test/repo')
    })

    it('throws when event payload is not an object', () => {
      state.db.prepare('INSERT INTO events (session_id, type, at, payload) VALUES (?, ?, ?, ?)')
        .run('test-1', 'session-started', '2026-01-01T00:00:00Z', JSON.stringify('bad-payload'))
      expect(() => getSessionEvents(createTestQueryDeps(state.db), 'test-1')).toThrow('Event payload must be an object.')
    })

    it('includes state when the events table has a state column', () => {
      const db = openSqliteDatabase(':memory:')
      db.exec(`
        CREATE TABLE events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          at TEXT NOT NULL,
          state TEXT,
          payload TEXT NOT NULL
        )
      `)
      db.prepare('INSERT INTO events (session_id, type, at, state, payload) VALUES (?, ?, ?, ?, ?)')
        .run('test-1', 'transitioned', '2026-01-01T00:00:00Z', 'PLANNING', JSON.stringify({
          type: 'transitioned',
          at: '2026-01-01T00:00:00Z',
          from: 'SPAWN',
          to: 'PLANNING',
        }))
      const events = getSessionEvents(createTestQueryDeps(db), 'test-1')
      expect(events[0]).toMatchObject({ state: 'PLANNING' })
      db.close()
    })
  })

  describe('getSessionEventsPaginated', () => {
    it('paginates events', () => {
      seedSessionEvents(state.db, 'test-1')
      const deps = createTestQueryDeps(state.db)
      const result = getSessionEventsPaginated(deps, 'test-1', 2, 0)
      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(7)
    })

    it('filters by type', () => {
      seedSessionEvents(state.db, 'test-1')
      const deps = createTestQueryDeps(state.db)
      const result = getSessionEventsPaginated(deps, 'test-1', 100, 0, {type: 'transitioned',})
      expect(result.events.every((event) => event.type === 'transitioned')).toBe(true)
      expect(result.total).toBe(3)
    })
  })

  describe('getMaxSeq', () => {
    it('returns 0 for empty database', () => {
      expect(getMaxSeq(createTestQueryDeps(state.db))).toBe(0)
    })

    it('returns highest sequence number', () => {
      seedSessionEvents(state.db, 'test-1')
      expect(getMaxSeq(createTestQueryDeps(state.db))).toBe(7)
    })

    it('throws for malformed maxSeq rows', () => {
      expect(() => getMaxSeq(createBrokenDeps('bad'))).toThrow('Expected maxSeq row.')
      expect(() => getMaxSeq(createBrokenDeps({ maxSeq: 'bad' }))).toThrow('Expected numeric maxSeq row.')
    })
  })

  describe('getEventsSinceSeq', () => {
    it('returns events after given sequence', () => {
      seedSessionEvents(state.db, 'test-1')
      const deps = createTestQueryDeps(state.db)
      const events = getEventsSinceSeq(deps, 5)
      expect(events).toHaveLength(2)
      expect(events[0]?.seq).toBe(6)
    })

    it('returns empty array when nothing new', () => {
      seedSessionEvents(state.db, 'test-1')
      const deps = createTestQueryDeps(state.db)
      const events = getEventsSinceSeq(deps, 7)
      expect(events).toHaveLength(0)
    })
  })

  describe('getSessionCount', () => {
    it('returns 0 for empty database', () => {
      expect(getSessionCount(createTestQueryDeps(state.db))).toBe(0)
    })

    it('returns count of distinct sessions', () => {
      seedMultipleSessions(state.db)
      expect(getSessionCount(createTestQueryDeps(state.db))).toBe(2)
    })

    it('throws for malformed count rows', () => {
      expect(() => getSessionCount(createBrokenDeps('bad'))).toThrow('Expected count row.')
    })
  })

  describe('getTotalEventCount', () => {
    it('returns 0 for empty database', () => {
      expect(getTotalEventCount(createTestQueryDeps(state.db))).toBe(0)
    })

    it('returns total event count', () => {
      seedSessionEvents(state.db, 'test-1')
      expect(getTotalEventCount(createTestQueryDeps(state.db))).toBe(7)
    })
  })

  describe('getSessionReflections', () => {
    it('returns empty array when reflections table is absent', () => {
      const db = openSqliteDatabase(':memory:')
      db.exec(`
        CREATE TABLE events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          at TEXT NOT NULL,
          payload TEXT NOT NULL
        )
      `)
      expect(getSessionReflections(createTestQueryDeps(db), 'test-1')).toStrictEqual([])
      db.close()
    })

    it('returns reflections newest first', () => {
      insertReflection(state.db, 'test-1', '2026-01-01T00:20:00Z', {
        findings: [{
          title: 'Later',
          category: 'tooling',
          opportunity: 'Use more structure',
          likelyCause: 'Tooling gap',
          suggestedChange: 'Use subagents',
          expectedImpact: 'Less churn',
          evidence: [{
            kind: 'event',
            seq: 3 
          }],
        }],
      })
      insertReflection(state.db, 'test-1', '2026-01-01T00:10:00Z', {
        findings: [{
          title: 'Earlier',
          category: 'workflow-design',
          opportunity: 'Add checkpoint',
          likelyCause: 'Late review',
          suggestedChange: 'Review sooner',
          expectedImpact: 'Less rework',
          evidence: [{
            kind: 'event-range',
            startSeq: 1,
            endSeq: 2 
          }],
        }],
      })

      const reflections = getSessionReflections(createTestQueryDeps(state.db), 'test-1')
      expect(reflections).toHaveLength(2)
      expect(reflections[0]?.createdAt).toBe('2026-01-01T00:20:00Z')
      expect(reflections[1]?.createdAt).toBe('2026-01-01T00:10:00Z')
    })

    it('throws for malformed reflection row', () => {
      expect(() => getSessionReflections(createReflectionDeps(['bad-row']), 'test-1')).toThrow('Expected reflection row.')
    })

    it('throws for non-string reflection payload_json', () => {
      expect(() => getSessionReflections(createReflectionDeps([{
        id: 1,
        session_id: 'test-1',
        created_at: '2026-01-01T00:00:00Z',
        label: null,
        agent_name: null,
        source_state: null,
        payload_json: 42,
      }]), 'test-1')).toThrow('Expected reflection payload_json string.')
    })
  })

  describe('getTranscriptPath', () => {
    it('returns null when session-started is missing', () => {
      expect(getTranscriptPath(createTestQueryDeps(state.db), 'missing')).toBeNull()
    })

    it('returns transcript path from session-started payload', () => {
      const transcriptPath = `${createSafeTempDir('session-queries-transcript-')}/transcript.jsonl`
      insertEvent(state.db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', { transcriptPath })
      expect(getTranscriptPath(createTestQueryDeps(state.db), 'test-1')).toBe(transcriptPath)
    })

    it('returns null when transcriptPath is not a string', () => {
      insertEvent(state.db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', {transcriptPath: 42,})
      expect(getTranscriptPath(createTestQueryDeps(state.db), 'test-1')).toBeNull()
    })

    it('returns null when payload is not an object', () => {
      state.db.prepare('INSERT INTO events (session_id, type, at, payload) VALUES (?, ?, ?, ?)')
        .run('test-1', 'session-started', '2026-01-01T00:00:00Z', JSON.stringify('payload-string'))
      expect(getTranscriptPath(createTestQueryDeps(state.db), 'test-1')).toBeNull()
    })

    it('throws for malformed transcript payload rows', () => {
      expect(() => getTranscriptPath(createCustomDeps([{ payload: 123 }]), 'test-1')).toThrow('Expected transcript payload row.')
    })
  })

  describe('getInitialState', () => {
    it('returns null when session-started event is missing', () => {
      expect(getInitialState(createTestQueryDeps(state.db), 'missing')).toBeNull()
    })

    it('returns state and startedAt from session-started payload', () => {
      insertEvent(state.db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', { currentState: 'IMPLEMENTING' })
      expect(getInitialState(createTestQueryDeps(state.db), 'test-1')).toStrictEqual({
        state: 'IMPLEMENTING',
        startedAt: '2026-01-01T00:00:00Z',
      })
    })

    it('returns null when currentState is missing', () => {
      insertEvent(state.db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', { foo: 'bar' })
      expect(getInitialState(createTestQueryDeps(state.db), 'test-1')).toBeNull()
    })

    it('returns null when currentState is empty string', () => {
      insertEvent(state.db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', { currentState: '' })
      expect(getInitialState(createTestQueryDeps(state.db), 'test-1')).toBeNull()
    })

    it('returns null when payload is not an object', () => {
      state.db.prepare('INSERT INTO events (session_id, type, at, payload) VALUES (?, ?, ?, ?)')
        .run('test-1', 'session-started', '2026-01-01T00:00:00Z', JSON.stringify('scalar'))
      expect(getInitialState(createTestQueryDeps(state.db), 'test-1')).toBeNull()
    })

    it('returns null when row is not a record', () => {
      expect(getInitialState(createCustomDeps(['not-a-record']), 'test-1')).toBeNull()
    })

    it('falls back to payload.at when row.at is absent', () => {
      const result = getInitialState(createCustomDeps([{
        payload: JSON.stringify({
          currentState: 'DEV',
          at: '2026-02-02T00:00:00Z' 
        }),
      }]), 'test-1')
      expect(result).toStrictEqual({
        state: 'DEV',
        startedAt: '2026-02-02T00:00:00Z' 
      })
    })

    it('returns empty startedAt when no at available', () => {
      const result = getInitialState(createCustomDeps([{payload: JSON.stringify({ currentState: 'DEV' }),}]), 'test-1')
      expect(result).toStrictEqual({
        state: 'DEV',
        startedAt: '' 
      })
    })

    it('returns null when payload is not a JSON string', () => {
      expect(getInitialState(createCustomDeps([{ payload: 42 }]), 'test-1')).toBeNull()
    })
  })
})
