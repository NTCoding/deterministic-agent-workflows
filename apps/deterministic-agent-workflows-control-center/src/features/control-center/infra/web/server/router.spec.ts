import { z } from 'zod'
import {
  describe, it, expect, vi 
} from 'vitest'
import {
  createRouter, sendJson, sendError 
} from './router'
import {
  createMockRequest, createMockResponse, parseJsonBody 
} from './http-test-fixtures'

const jsonBodySchema = z.object({ key: z.string() })
const errorBodySchema = z.object({ error: z.string() })

describe('createRouter', () => {
  it('routes exact paths', async () => {
    const router = createRouter()
    const handler = vi.fn()
    router.get('/api/test', handler)

    const req = createMockRequest('GET', '/api/test')
    const response = createMockResponse()
    const handled = await router.handle(req, response.res)
    expect(handled).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(req, response.res, {
      path: '/api/test',
      query: new URLSearchParams(),
      params: {},
    })
  })

  it('extracts route params', async () => {
    const router = createRouter()
    const captured: { route?: { params: Record<string, string> } } = {}
    router.get('/api/sessions/:id', (_req, _res, route) => {
      captured.route = route
    })

    const response = createMockResponse()
    await router.handle(createMockRequest('GET', '/api/sessions/abc-123'), response.res)
    expect(captured.route?.params['id']).toBe('abc-123')
  })

  it('parses query parameters', async () => {
    const router = createRouter()
    const captured: { query?: URLSearchParams } = {}
    router.get('/api/sessions', (_req, _res, route) => {
      captured.query = route.query
    })

    await router.handle(createMockRequest('GET', '/api/sessions?status=active&limit=10'), createMockResponse().res)
    expect(captured.query?.get('status')).toBe('active')
    expect(captured.query?.get('limit')).toBe('10')
  })

  it('returns false for no matching route', async () => {
    const router = createRouter()
    const handled = await router.handle(createMockRequest('GET', '/nonexistent'), createMockResponse().res)
    expect(handled).toBe(false)
  })

  it('handles missing method and url', async () => {
    const router = createRouter()
    router.get('/', vi.fn())
    const req = createMockRequest()
    req.method = undefined
    req.url = undefined
    const handled = await router.handle(req, createMockResponse().res)
    expect(handled).toBe(true)
  })

  it('does not match wrong method', async () => {
    const router = createRouter()
    router.get('/api/test', vi.fn())

    const handled = await router.handle(createMockRequest('POST', '/api/test'), createMockResponse().res)
    expect(handled).toBe(false)
  })
})

describe('sendJson', () => {
  it('sends JSON with correct headers', () => {
    const response = createMockResponse()
    sendJson(response.res, 200, { key: 'value' })
    expect(response.written.statusCode).toBe(200)
    expect(response.written.headers['Content-Type']).toBe('application/json')
    expect(parseJsonBody(response.written.body, jsonBodySchema)).toStrictEqual({ key: 'value' })
  })
})

describe('sendError', () => {
  it('sends error as JSON', () => {
    const response = createMockResponse()
    sendError(response.res, 404, 'Not found')
    expect(response.written.statusCode).toBe(404)
    expect(parseJsonBody(response.written.body, errorBodySchema)).toStrictEqual({ error: 'Not found' })
  })
})
