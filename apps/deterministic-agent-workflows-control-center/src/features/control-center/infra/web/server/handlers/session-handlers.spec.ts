import type {IncomingMessage} from 'node:http'
import { z } from 'zod'
import type { SqliteDatabase } from '../../../../domain/query/sqlite-runtime'
import {
  createTestDb,
  insertEvent,
  insertReflection,
  seedSessionEvents,
  seedMultipleSessions,
} from '../../../../domain/query/session-queries-test-fixtures'
import {
  handleListSessions,
  handleGetSession,
  handleGetSessionEvents,
  handleGetSessionJournal,
  handleGetSessionInsights,
  handleGetSessionReflections,
} from './session-handlers'
import type { SessionHandlerDeps } from './session-handlers'
import {
  describe, it, expect, beforeEach 
} from 'vitest'
import {
  createMockRequest, createMockResponse, createSafeTempDir, parseJsonBody 
} from '../http-test-fixtures'

function mockReq(): IncomingMessage {
  return createMockRequest()
}

function makeRoute(params: Record<string, string> = {}, query: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(query)
  return {
    path: '/test',
    query: searchParams,
    params 
  }
}

describe('session-handlers', () => {
  const state: {
    db: SqliteDatabase
    deps: SessionHandlerDeps
  } = {
    db: createTestDb(),
    deps: {
      queryDeps: { db: createTestDb() },
      now: () => new Date('2026-01-01T00:15:00Z'),
    },
  }

  const listBodySchema = z.object({
    sessions: z.array(z.object({ status: z.string() }).passthrough()),
    total: z.number(),
  })
  const detailBodySchema = z.object({
    sessionId: z.string(),
    workflowStates: z.array(z.string()),
    insights: z.array(z.unknown()),
    suggestions: z.array(z.unknown()),
    statePeriods: z.array(z.unknown()),
  }).passthrough()
  const eventsBodySchema = z.object({
    events: z.array(z.object({
      type: z.string(),
      state: z.string().optional(),
      category: z.string().optional(),
      detail: z.string().optional(),
      denied: z.boolean().optional(),
    }).passthrough()),
    total: z.number(),
  })
  const journalBodySchema = z.object({ entries: z.array(z.unknown()) })
  const insightsBodySchema = z.object({ insights: z.array(z.unknown()) })
  const reflectionsBodySchema = z.object({
    reflections: z.array(z.object({
      id: z.number(),
      createdAt: z.string(),
      reflection: z.object({ findings: z.array(z.unknown()) }),
    }).passthrough()) 
  })

  beforeEach(() => {
    state.db = createTestDb()
    state.deps = {
      queryDeps: { db: state.db },
      now: () => new Date('2026-01-01T00:15:00Z'),
    }
  })

  describe('handleListSessions', () => {
    it('returns empty sessions for empty db', () => {
      const handler = handleListSessions(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      const body = parseJsonBody(response.written.body, listBodySchema)
      expect(body.sessions).toStrictEqual([])
      expect(body.total).toBe(0)
    })

    it('returns sessions with projections', () => {
      seedMultipleSessions(state.db)
      const handler = handleListSessions(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      const body = parseJsonBody(response.written.body, listBodySchema)
      expect(body.sessions).toHaveLength(2)
      expect(body.total).toBe(2)
    })

    it('filters by status', () => {
      seedMultipleSessions(state.db)
      const handler = handleListSessions(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, { status: 'active' }))
      const body = parseJsonBody(response.written.body, listBodySchema)
      expect(body.sessions.every((summary: { status: string }) => summary.status === 'active')).toBe(true)
    })

    it('paginates results', () => {
      seedMultipleSessions(state.db)
      const handler = handleListSessions(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, {
        limit: '1',
        offset: '0' 
      }))
      const body = parseJsonBody(response.written.body, listBodySchema)
      expect(body.sessions).toHaveLength(1)
    })
  })

  describe('handleGetSession', () => {
    it('returns 404 for unknown session', () => {
      const handler = handleGetSession(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'nonexistent' }))
      expect(response.written.statusCode).toBe(404)
    })

    it('returns session detail with insights', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSession(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, detailBodySchema)
      expect(body).toMatchObject({ sessionId: 'test-1' })
      expect(body.workflowStates).toContain('SPAWN')
      expect(body).toStrictEqual(expect.objectContaining({
        insights: expect.any(Array),
        statePeriods: expect.any(Array),
      }))
    })

    it('returns 400 for missing session ID', () => {
      const handler = handleGetSession(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}))
      expect(response.written.statusCode).toBe(400)
    })

    it('includes suggestions in response', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSession(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      const body = parseJsonBody(response.written.body, detailBodySchema)
      expect(body.suggestions).toBeDefined()
      expect(Array.isArray(body.suggestions)).toBe(true)
    })
  })

  describe('handleGetSessionEvents', () => {
    it('returns annotated events', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, eventsBodySchema)
      expect(body.events.length).toBeGreaterThan(0)
      expect(body.events[0]).toMatchObject({
        category: expect.any(String),
        detail: expect.any(String),
      })
    })

    it('uses session-started currentState for pre-transition event annotation', () => {
      insertEvent(state.db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', { currentState: 'SPAWN' })
      insertEvent(state.db, 'test-1', 'write-checked', '2026-01-01T00:01:00Z', {
        tool: 'Write',
        filePath: `${createSafeTempDir('wcc-session-path-')}/test.ts`,
        allowed: true,
      })
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      const body = parseJsonBody(response.written.body, eventsBodySchema)
      expect(body.events[0]?.state).toBe('SPAWN')
      expect(body.events[1]?.state).toBe('SPAWN')
    })

    it('filters by category', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }, { category: 'transition' }))
      const body = parseJsonBody(response.written.body, eventsBodySchema)
      expect(body.events.every((event) => event.category === 'transition')).toBe(true)
    })

    it('filters by denied status', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }, { denied: 'true' }))
      const body = parseJsonBody(response.written.body, eventsBodySchema)
      expect(body.events.every((event) => event.denied === true)).toBe(true)
    })

    it('filters denied=false', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }, { denied: 'false' }))
      const body = parseJsonBody(response.written.body, eventsBodySchema)
      expect(body.events.every((event) => event.denied === false || event.denied === undefined)).toBe(true)
    })

    it('filters by type', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }, { type: 'transitioned' }))
      const body = parseJsonBody(response.written.body, eventsBodySchema)
      expect(body.events.every((event: { type: string }) => event.type === 'transitioned')).toBe(true)
    })

    it('returns 400 for missing session ID', () => {
      const handler = handleGetSessionEvents(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}))
      expect(response.written.statusCode).toBe(400)
    })
  })

  describe('handleGetSessionJournal', () => {
    it('returns journal entries', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionJournal(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, journalBodySchema)
      expect(body.entries).toBeDefined()
    })

    it('returns 404 for unknown session', () => {
      const handler = handleGetSessionJournal(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'nonexistent' }))
      expect(response.written.statusCode).toBe(404)
    })

    it('returns 400 for missing session ID', () => {
      const handler = handleGetSessionJournal(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}))
      expect(response.written.statusCode).toBe(400)
    })
  })

  describe('handleGetSessionInsights', () => {
    it('returns insights for session', () => {
      seedSessionEvents(state.db, 'test-1')
      const handler = handleGetSessionInsights(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, insightsBodySchema)
      expect(body.insights).toBeDefined()
    })

    it('returns 404 for unknown session', () => {
      const handler = handleGetSessionInsights(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'nonexistent' }))
      expect(response.written.statusCode).toBe(404)
    })

    it('returns 400 for missing session ID', () => {
      const handler = handleGetSessionInsights(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}))
      expect(response.written.statusCode).toBe(400)
    })
  })

  describe('handleGetSessionReflections', () => {
    it('returns reflections newest first', () => {
      seedSessionEvents(state.db, 'test-1')
      insertReflection(state.db, 'test-1', '2026-01-01T00:20:00Z', {
        findings: [{
          title: 'Later',
          category: 'tooling',
          opportunity: 'Use subagents',
          likelyCause: 'Manual repetition',
          suggestedChange: 'Delegate',
          expectedImpact: 'Less repeated work',
          evidence: [{
            kind: 'event',
            seq: 2 
          }],
        }],
      })
      insertReflection(state.db, 'test-1', '2026-01-01T00:10:00Z', {
        findings: [{
          title: 'Earlier',
          category: 'review-rework',
          opportunity: 'Review sooner',
          likelyCause: 'Late detection',
          suggestedChange: 'Add checkpoint',
          expectedImpact: 'Less rework',
          evidence: [{
            kind: 'event-range',
            startSeq: 1,
            endSeq: 3 
          }],
        }],
      })
      const handler = handleGetSessionReflections(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'test-1' }))
      const body = parseJsonBody(response.written.body, reflectionsBodySchema)
      expect(response.written.statusCode).toBe(200)
      expect(body.reflections).toHaveLength(2)
      expect(body.reflections[0]?.createdAt).toBe('2026-01-01T00:20:00Z')
    })

    it('returns 404 for unknown session', () => {
      const handler = handleGetSessionReflections(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({ id: 'nonexistent' }))
      expect(response.written.statusCode).toBe(404)
    })
  })
})
