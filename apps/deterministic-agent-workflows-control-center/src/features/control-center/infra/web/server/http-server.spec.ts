import http from 'node:http'
import {
  mkdirSync, writeFileSync, rmSync 
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  describe, it, expect, beforeEach, afterEach 
} from 'vitest'
import {
  createTestDb,
  seedReviewSimulation,
  seedSessionEvents,
  seedMultipleSessions,
} from '../../../domain/query/session-queries-test-fixtures'
import type { SqliteDatabase } from '../../../domain/query/sqlite-runtime'
import { createHttpServer } from './http-server'
import type { HttpServerInstance } from './http-server'
import {
  createSafeTempDir,
  parseJsonBody,
  TestInvariantError,
} from './http-test-fixtures'

function httpGet(port: number, path: string): Promise<{
  statusCode: number;
  body: string 
}> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      const responseState = { body: '' }
      res.on('data', (chunk: Buffer) => { responseState.body += chunk.toString() })
      res.on('end', () => resolve({
        statusCode: res.statusCode ?? 0,
        body: responseState.body,
      }))
    }).on('error', reject)
  })
}

describe('createHttpServer', () => {
  const state: {
    db: SqliteDatabase
    server: HttpServerInstance
    distDir: string
  } = {
    db: createTestDb(),
    server: createHttpServer({
      queryDeps: { db: createTestDb() },
      distDir: createSafeTempDir('wcc-bootstrap-'),
      now: () => new Date('2026-01-01T00:15:00Z'),
    }),
    distDir: createSafeTempDir('wcc-bootstrap-'),
  }

  const sessionsSchema = z.object({ sessions: z.array(z.unknown()) })
  const sessionSchema = z.object({ sessionId: z.string() })
  const overviewSchema = z.object({ totalSessions: z.number() })

  beforeEach(async () => {
    state.db = createTestDb()
    state.distDir = createSafeTempDir('wcc-test-')
    mkdirSync(state.distDir, { recursive: true })
    writeFileSync(join(state.distDir, 'index.html'), '<html>test</html>')

    state.server = createHttpServer({
      queryDeps: { db: state.db },
      distDir: state.distDir,
      now: () => new Date('2026-01-01T00:15:00Z'),
    })
  })

  afterEach(async () => {
    await state.server.stop()
    rmSync(state.distDir, {
      recursive: true,
      force: true 
    })
  })

  function getPort(): number {
    const addr = state.server.server.address()
    if (typeof addr === 'object' && addr !== null) return addr.port
    throw new TestInvariantError('Server not started')
  }

  it('serves API sessions endpoint', async () => {
    seedMultipleSessions(state.db)
    await state.server.start(0)
    const {
      statusCode, body 
    } = await httpGet(getPort(), '/api/sessions')
    expect(statusCode).toBe(200)
    const parsed = parseJsonBody(body, sessionsSchema)
    expect(parsed.sessions).toHaveLength(2)
  })

  it('serves session detail endpoint', async () => {
    seedSessionEvents(state.db, 'test-1')
    await state.server.start(0)
    const {
      statusCode, body 
    } = await httpGet(getPort(), '/api/sessions/test-1')
    expect(statusCode).toBe(200)
    const parsed = parseJsonBody(body, sessionSchema)
    expect(parsed.sessionId).toBe('test-1')
  })

  it('serves static files', async () => {
    await state.server.start(0)
    const {
      statusCode, body 
    } = await httpGet(getPort(), '/')
    expect(statusCode).toBe(200)
    expect(body).toContain('<html>')
  })

  it('returns 404 for unknown paths', async () => {
    await state.server.start(0)
    const { statusCode } = await httpGet(getPort(), '/nonexistent/path')
    expect(statusCode).toBe(404)
  })

  it('serves analytics overview', async () => {
    seedMultipleSessions(state.db)
    await state.server.start(0)
    const {
      statusCode, body 
    } = await httpGet(getPort(), '/api/analytics/overview')
    expect(statusCode).toBe(200)
    const parsed = parseJsonBody(body, overviewSchema)
    expect(parsed.totalSessions).toBe(2)
  })

  it('serves reviews endpoint', async () => {
    seedReviewSimulation(state.db, 'test-1')
    await state.server.start(0)
    const {
      statusCode, body
    } = await httpGet(getPort(), '/api/reviews?reviewType=code-review&verdict=FAIL')
    expect(statusCode).toBe(200)
    const parsed = parseJsonBody(body, z.object({
      reviews: z.array(z.object({
        reviewType: z.string(),
        verdict: z.string(),
      })),
    }))
    expect(parsed.reviews).toHaveLength(1)
    expect(parsed.reviews[0]?.reviewType).toBe('code-review')
  })

  it('returns 500 for server errors', async () => {
    const brokenDb = createTestDb()
    brokenDb.close()
    const brokenServer = createHttpServer({
      queryDeps: { db: brokenDb },
      distDir: state.distDir,
      now: () => new Date('2026-01-01T00:15:00Z'),
    })
    await brokenServer.start(0)
    const addr = brokenServer.server.address()
    const brokenPort = typeof addr === 'object' && addr !== null ? addr.port : 0
    const { statusCode } = await httpGet(brokenPort, '/api/sessions')
    expect(statusCode).toBe(500)
    await brokenServer.stop()
  })

  it('handles requests with query strings in static paths', async () => {
    await state.server.start(0)
    const { statusCode } = await httpGet(getPort(), '/?foo=bar')
    expect(statusCode).toBe(200)
  })

  it('serves SSE endpoint', async () => {
    await state.server.start(0)
    const actualPort = getPort()

    const connected = new Promise<string>((resolve) => {
      http.get(`http://localhost:${actualPort}/events`, (res) => {
        const eventState = { data: '' }
        res.on('data', (chunk: Buffer) => {
          eventState.data += chunk.toString()
          if (eventState.data.includes('connected')) {
            res.destroy()
            resolve(eventState.data)
          }
        })
      })
    })

    const sseData = await connected
    expect(sseData).toContain('event: connected')
  })
})
