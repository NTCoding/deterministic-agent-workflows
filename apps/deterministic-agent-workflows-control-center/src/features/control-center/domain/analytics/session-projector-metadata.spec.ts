import {
  describe, it, expect,
} from 'vitest'
import type { ParsedEvent } from '../query/query-types'
import {
  createProjectionCache,
  projectSession,
  projectSessionSummary,
} from './session-projector'
import { makeEvents } from './session-projector-test-fixtures'

describe('projectSession domain metadata', () => {
  it('extracts issueNumber from issue-recorded event', () => {
    const events: ReadonlyArray<ParsedEvent> = [{
      seq: 1,
      sessionId: 's1',
      type: 'issue-recorded',
      at: '2026-01-01T00:00:00Z',
      payload: { issueNumber: 42 } 
    }]
    const projection = projectSession('s1', events)
    expect(projection.issueNumber).toBe(42)
    expect(projection.totalEvents).toBe(1)
  })

  it('extracts featureBranch from branch-recorded event', () => {
    const events: ReadonlyArray<ParsedEvent> = [{
      seq: 1,
      sessionId: 's1',
      type: 'branch-recorded',
      at: '2026-01-01T00:00:00Z',
      payload: { branch: 'feat/login' } 
    }]
    const projection = projectSession('s1', events)
    expect(projection.featureBranch).toBe('feat/login')
    expect(projection.totalEvents).toBe(1)
  })

  it('extracts prNumber from pr-recorded event', () => {
    const events: ReadonlyArray<ParsedEvent> = [{
      seq: 1,
      sessionId: 's1',
      type: 'pr-recorded',
      at: '2026-01-01T00:00:00Z',
      payload: { prNumber: 99 } 
    }]
    const projection = projectSession('s1', events)
    expect(projection.prNumber).toBe(99)
    expect(projection.totalEvents).toBe(1)
  })

  it('skips malformed domain metadata events', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'issue-recorded',
        at: '2026-01-01T00:00:00Z',
        payload: {} 
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'branch-recorded',
        at: '2026-01-01T00:01:00Z',
        payload: {} 
      },
      {
        seq: 3,
        sessionId: 's1',
        type: 'pr-recorded',
        at: '2026-01-01T00:02:00Z',
        payload: {} 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection).toMatchObject({
      issueNumber: undefined,
      featureBranch: undefined,
      prNumber: undefined,
      totalEvents: 3,
    })
  })

  it('combines engine and domain metadata events', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:00:00Z',
        payload: { repository: 'org/repo' } 
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'issue-recorded',
        at: '2026-01-01T00:01:00Z',
        payload: { issueNumber: 7 } 
      },
      {
        seq: 3,
        sessionId: 's1',
        type: 'branch-recorded',
        at: '2026-01-01T00:02:00Z',
        payload: { branch: 'feat/thing' } 
      },
      {
        seq: 4,
        sessionId: 's1',
        type: 'pr-recorded',
        at: '2026-01-01T00:03:00Z',
        payload: { prNumber: 15 } 
      },
      {
        seq: 5,
        sessionId: 's1',
        type: 'transitioned',
        at: '2026-01-01T00:04:00Z',
        payload: {
          from: 'idle',
          to: 'SPAWN' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection).toMatchObject({
      repository: 'org/repo',
      issueNumber: 7,
      featureBranch: 'feat/thing',
      prNumber: 15,
      currentState: 'SPAWN',
      totalEvents: 5,
    })
  })
})

describe('projectSessionSummary', () => {
  it('computes duration from first to last event', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    const now = new Date('2026-01-01T00:05:00Z')
    const summary = projectSessionSummary(projection, now)
    expect(summary.durationMs).toBe(11 * 60 * 1000)
  })

  it('determines session status based on time', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    const recentNow = new Date('2026-01-01T00:20:00Z')
    expect(projectSessionSummary(projection, recentNow).status).toBe('active')

    const staleNow = new Date('2026-01-01T02:00:00Z')
    expect(projectSessionSummary(projection, staleNow).status).toBe('stale')
  })

  it('returns completed for empty projections', () => {
    const projection = projectSession('s1', [])
    const summary = projectSessionSummary(projection, new Date())
    expect(summary.status).toBe('completed')
    expect(summary.durationMs).toBe(0)
  })
})

describe('createProjectionCache', () => {
  it('starts empty', () => {
    const cache = createProjectionCache()
    expect(cache.size()).toBe(0)
    expect(cache.get('nonexistent')).toBeUndefined()
  })

  it('stores and retrieves projections', () => {
    const cache = createProjectionCache()
    const projection = projectSession('s1', makeEvents('s1'))
    cache.set('s1', projection)
    expect(cache.size()).toBe(1)
    expect(cache.get('s1')?.currentState).toBe('DEVELOPING')
  })

  it('applies events incrementally to existing', () => {
    const cache = createProjectionCache()
    cache.set('s1', projectSession('s1', makeEvents('s1')))
    const updated = cache.applyEvent({
      seq: 9,
      sessionId: 's1',
      type: 'transitioned',
      at: '2026-01-01T00:15:00Z',
      payload: {
        from: 'DEVELOPING',
        to: 'REVIEWING' 
      },
    })
    expect(updated.currentState).toBe('REVIEWING')
    expect(updated.transitionCount).toBe(4)
  })

  it('creates new projection for unknown session', () => {
    const cache = createProjectionCache()
    const projection = cache.applyEvent({
      seq: 1,
      sessionId: 'new-session',
      type: 'session-started',
      at: '2026-01-01T00:00:00Z',
      payload: { repository: 'test/repo' },
    })
    expect(projection.sessionId).toBe('new-session')
    expect(cache.size()).toBe(1)
  })

  it('evicts stale projections', () => {
    const cache = createProjectionCache()
    cache.set('s1', projectSession('s1', makeEvents('s1')))
    const evicted = cache.evictStale(new Date('2026-01-02T00:00:00Z'))
    expect(evicted).toBe(1)
    expect(cache.size()).toBe(0)
  })

  it('keeps recent projections on eviction', () => {
    const cache = createProjectionCache()
    cache.set('s1', projectSession('s1', makeEvents('s1')))
    const evicted = cache.evictStale(new Date('2026-01-01T00:20:00Z'))
    expect(evicted).toBe(0)
    expect(cache.size()).toBe(1)
  })
})
