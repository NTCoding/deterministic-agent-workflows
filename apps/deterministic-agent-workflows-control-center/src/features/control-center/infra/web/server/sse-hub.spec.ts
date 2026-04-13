import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest'
import { createSseHub } from './sse-hub'
import {
  createMockResponse,
  TestInvariantError,
} from './http-test-fixtures'

function mockSseResponse(): {
  response: ReturnType<typeof createMockResponse>
  chunks: Array<string>
} {
  const response = createMockResponse()
  const chunks: Array<string> = []
  response.res.write = (chunk) => {
    if (typeof chunk === 'string') {
      chunks.push(chunk)
      return true
    }
    throw new TestInvariantError('Expected SSE chunks to be strings.')
  }
  return {
    response,
    chunks 
  }
}

describe('createSseHub', () => {
  const state: { hub: ReturnType<typeof createSseHub> } = { hub: createSseHub() }

  beforeEach(() => {
    state.hub = createSseHub()
  })

  afterEach(() => {
    state.hub.stopHeartbeat()
  })

  it('starts with zero connections', () => {
    expect(state.hub.connectionCount()).toBe(0)
  })

  it('adds connections and sends connected event', () => {
    const res = mockSseResponse()
    state.hub.addConnection('conn-1', res.response.res)
    expect(state.hub.connectionCount()).toBe(1)
    expect(res.response.written.statusCode).toBe(200)
    expect(res.chunks.length).toBeGreaterThan(0)
    expect(res.chunks[0]).toContain('event: connected')
  })

  it('removes connections', () => {
    const res = mockSseResponse()
    state.hub.addConnection('conn-1', res.response.res)
    state.hub.removeConnection('conn-1')
    expect(state.hub.connectionCount()).toBe(0)
  })

  it('broadcasts to all connections', () => {
    const res1 = mockSseResponse()
    const res2 = mockSseResponse()
    state.hub.addConnection('conn-1', res1.response.res)
    state.hub.addConnection('conn-2', res2.response.res)

    state.hub.broadcast('new-event', { test: true })
    expect(res1.chunks.some((chunk) => chunk.includes('new-event'))).toBe(true)
    expect(res2.chunks.some((chunk) => chunk.includes('new-event'))).toBe(true)
  })

  it('filters by session when broadcasting', () => {
    const res1 = mockSseResponse()
    const res2 = mockSseResponse()
    state.hub.addConnection('conn-1', res1.response.res, 'session-a')
    state.hub.addConnection('conn-2', res2.response.res, 'session-b')

    state.hub.broadcast('new-event', { test: true }, 'session-a')
    const res1HasEvent = res1.chunks.some((chunk) => chunk.includes('"test":true'))
    const res2HasEvent = res2.chunks.some((chunk) => chunk.includes('"test":true'))
    expect(res1HasEvent).toBe(true)
    expect(res2HasEvent).toBe(false)
  })

  it('removes connection on close event', () => {
    const res = mockSseResponse()
    state.hub.addConnection('conn-1', res.response.res)
    expect(state.hub.connectionCount()).toBe(1)

    res.response.res.emit('close')
    expect(state.hub.connectionCount()).toBe(0)
  })

  it('handles write errors by removing connection', () => {
    const res = mockSseResponse()
    state.hub.addConnection('conn-1', res.response.res)

    res.response.res.write = () => {
      throw new TestInvariantError('Connection closed')
    }

    state.hub.broadcast('test', { data: 1 })
    expect(state.hub.connectionCount()).toBe(0)
  })

  it('starts and stops heartbeat', () => {
    vi.useFakeTimers()
    state.hub.startHeartbeat()

    const res = mockSseResponse()
    state.hub.addConnection('conn-1', res.response.res)

    vi.advanceTimersByTime(30000)
    const hasHeartbeat = res.chunks.some((chunk) => chunk === ':\n\n')
    expect(hasHeartbeat).toBe(true)

    state.hub.stopHeartbeat()
    vi.useRealTimers()
  })

  it('removing non-existent connection is safe', () => {
    state.hub.removeConnection('nonexistent')
    expect(state.hub.connectionCount()).toBe(0)
  })

  it('removes connection on heartbeat write error', () => {
    vi.useFakeTimers()
    state.hub.startHeartbeat()

    const res = mockSseResponse()
    state.hub.addConnection('conn-1', res.response.res)

    res.response.res.write = () => {
      throw new TestInvariantError('Connection broken')
    }

    vi.advanceTimersByTime(30000)
    expect(state.hub.connectionCount()).toBe(0)

    state.hub.stopHeartbeat()
    vi.useRealTimers()
  })
})
