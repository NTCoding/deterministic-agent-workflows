import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest'
import type { ParsedEvent } from '../query/query-types'
import type { SqliteDatabase } from '../query/sqlite-runtime'
import {
  createTestDb,
  createTestQueryDeps,
  seedSessionEvents,
  insertEvent,
} from '../query/session-queries-test-fixtures'
import { createEventWatcher } from './event-watcher'

describe('createEventWatcher', () => {
  const state: {db: SqliteDatabase} = {db: createTestDb(),}

  beforeEach(() => {
    vi.useFakeTimers()
    state.db = createTestDb()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts and stops', () => {
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents: vi.fn(),
    })

    watcher.start()
    expect(watcher.isRunning()).toBe(true)

    watcher.stop()
    expect(watcher.isRunning()).toBe(false)
  })

  it('initializes lastSeenSeq on start', () => {
    seedSessionEvents(state.db, 'test-1')
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents: vi.fn(),
    })

    watcher.start()
    expect(watcher.lastSeenSeq()).toBe(7)
    watcher.stop()
  })

  it('detects new events on poll', () => {
    seedSessionEvents(state.db, 'test-1')
    const received: {
      events: ReadonlyArray<ParsedEvent>
      callCount: number
    } = {
      events: [],
      callCount: 0,
    }
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents(events) {
        received.events = events
        received.callCount += 1
      },
      pollIntervalMs: 100,
    })

    watcher.start()

    insertEvent(state.db, 'test-1', 'transitioned', '2026-01-01T00:15:00Z', {
      from: 'DEVELOPING',
      to: 'REVIEWING',
    })

    vi.advanceTimersByTime(100)
    expect(received.callCount).toBe(1)
    expect(received.events).toHaveLength(1)
    expect(received.events[0]?.type).toBe('transitioned')

    watcher.stop()
  })

  it('does not callback when no new events', () => {
    seedSessionEvents(state.db, 'test-1')
    const onNewEvents = vi.fn()
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents,
      pollIntervalMs: 100,
    })

    watcher.start()
    vi.advanceTimersByTime(100)
    expect(onNewEvents).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('updates lastSeenSeq after detecting events', () => {
    seedSessionEvents(state.db, 'test-1')
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents: vi.fn(),
      pollIntervalMs: 100,
    })

    watcher.start()
    expect(watcher.lastSeenSeq()).toBe(7)

    insertEvent(state.db, 'test-1', 'journal-entry', '2026-01-01T00:15:00Z', {
      agentName: 'test',
      content: 'note',
    })

    vi.advanceTimersByTime(100)
    expect(watcher.lastSeenSeq()).toBe(8)
    watcher.stop()
  })

  it('ignores double start', () => {
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents: vi.fn(),
    })

    watcher.start()
    watcher.start()
    expect(watcher.isRunning()).toBe(true)
    watcher.stop()
  })

  it('handles SQLite errors during poll gracefully', () => {
    seedSessionEvents(state.db, 'test-1')
    const onNewEvents = vi.fn()
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents,
      pollIntervalMs: 100,
    })

    watcher.start()
    state.db.close()

    vi.advanceTimersByTime(100)
    expect(onNewEvents).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('ignores double stop', () => {
    const watcher = createEventWatcher({
      queryDeps: createTestQueryDeps(state.db),
      onNewEvents: vi.fn(),
    })

    watcher.start()
    watcher.stop()
    watcher.stop()
    expect(watcher.isRunning()).toBe(false)
  })
})
