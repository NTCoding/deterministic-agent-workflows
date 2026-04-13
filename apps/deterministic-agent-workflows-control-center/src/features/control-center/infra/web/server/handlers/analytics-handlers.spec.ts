import type {IncomingMessage} from 'node:http'
import { z } from 'zod'
import type { SqliteDatabase } from '../../../../domain/query/sqlite-runtime'
import {
  createTestDb,
  seedMultipleSessions,
  seedSessionEvents,
} from '../../../../domain/query/session-queries-test-fixtures'
import {
  handleAnalyticsOverview,
  handleAnalyticsTrends,
  handleAnalyticsPatterns,
  handleAnalyticsCompare,
} from './analytics-handlers'
import type { AnalyticsHandlerDeps } from './analytics-handlers'
import {
  describe, it, expect, beforeEach 
} from 'vitest'
import {
  createMockRequest, createMockResponse, parseJsonBody 
} from '../http-test-fixtures'

function mockReq(): IncomingMessage {
  return createMockRequest()
}

function makeRoute(params: Record<string, string> = {}, query: Record<string, string> = {}) {
  return {
    path: '/test',
    query: new URLSearchParams(query),
    params 
  }
}

describe('analytics-handlers', () => {
  const state: {
    db: SqliteDatabase
    deps: AnalyticsHandlerDeps
  } = {
    db: createTestDb(),
    deps: {
      queryDeps: { db: createTestDb() },
      now: () => new Date('2026-01-01T00:15:00Z'),
    },
  }

  const overviewSchema = z.object({
    totalSessions: z.number(),
    denialHotspots: z.array(z.unknown()),
    stateTimeDistribution: z.array(z.unknown()),
  })
  const trendsSchema = z.object({ dataPoints: z.array(z.unknown()) })
  const patternsSchema = z.object({ patterns: z.array(z.unknown()) })
  const compareSchema = z.object({
    sessionA: z.unknown(),
    sessionB: z.unknown(),
    deltas: z.unknown(),
  })

  beforeEach(() => {
    state.db = createTestDb()
    state.deps = {
      queryDeps: { db: state.db },
      now: () => new Date('2026-01-01T00:15:00Z'),
    }
  })

  describe('handleAnalyticsOverview', () => {
    it('returns overview for empty db', () => {
      const handler = handleAnalyticsOverview(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, overviewSchema)
      expect(body.totalSessions).toBe(0)
    })

    it('returns overview with sessions', () => {
      seedMultipleSessions(state.db)
      const handler = handleAnalyticsOverview(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      const body = parseJsonBody(response.written.body, overviewSchema)
      expect(body.totalSessions).toBe(2)
      expect(body.denialHotspots).toBeDefined()
      expect(body.stateTimeDistribution).toBeDefined()
    })
  })

  describe('handleAnalyticsTrends', () => {
    it('returns trend data points', () => {
      seedMultipleSessions(state.db)
      const handler = handleAnalyticsTrends(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, {
        metric: 'duration',
        window: '7d',
        bucket: 'day' 
      }))
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, trendsSchema)
      expect(body.dataPoints).toBeDefined()
    })

    it('uses defaults when params not provided', () => {
      const handler = handleAnalyticsTrends(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      expect(response.written.statusCode).toBe(200)
    })

    it('handles 7d window', () => {
      const handler = handleAnalyticsTrends(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, { window: '7d' }))
      expect(response.written.statusCode).toBe(200)
    })

    it('handles 90d window', () => {
      const handler = handleAnalyticsTrends(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, { window: '90d' }))
      expect(response.written.statusCode).toBe(200)
    })
  })

  describe('handleAnalyticsPatterns', () => {
    it('returns patterns', () => {
      seedMultipleSessions(state.db)
      const handler = handleAnalyticsPatterns(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, patternsSchema)
      expect(body.patterns).toBeDefined()
    })
  })

  describe('handleAnalyticsCompare', () => {
    it('returns 400 when params missing', () => {
      const handler = handleAnalyticsCompare(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute())
      expect(response.written.statusCode).toBe(400)
    })

    it('returns 404 for unknown session A', () => {
      const handler = handleAnalyticsCompare(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, {
        a: 'nonexistent',
        b: 'also-nonexistent' 
      }))
      expect(response.written.statusCode).toBe(404)
    })

    it('returns 404 for unknown session B', () => {
      seedSessionEvents(state.db, 'session-a')
      const handler = handleAnalyticsCompare(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, {
        a: 'session-a',
        b: 'nonexistent' 
      }))
      expect(response.written.statusCode).toBe(404)
    })

    it('returns comparison for valid sessions', () => {
      seedMultipleSessions(state.db)
      const handler = handleAnalyticsCompare(state.deps)
      const response = createMockResponse()
      handler(mockReq(), response.res, makeRoute({}, {
        a: 'session-a',
        b: 'session-b' 
      }))
      expect(response.written.statusCode).toBe(200)
      const body = parseJsonBody(response.written.body, compareSchema)
      expect(body.sessionA).toBeDefined()
      expect(body.sessionB).toBeDefined()
      expect(body.deltas).toBeDefined()
    })
  })
})
