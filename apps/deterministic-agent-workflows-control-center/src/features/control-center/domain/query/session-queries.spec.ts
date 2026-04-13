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
  getTotalEventCount,
} from './session-queries'
import {
  createTestDb,
  createTestQueryDeps,
  seedSessionEvents,
  seedMultipleSessions,
} from './session-queries-test-fixtures'
import type { SqliteDatabase } from './sqlite-runtime'

function createBrokenDeps(getValue: unknown): { readonly db: SqliteDatabase } {
  return {
    db: {
      prepare: () => ({
        all: () => [],
        get: () => getValue,
        run: () => undefined,
      }),
      exec: () => {},
      close: () => {},
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
})
