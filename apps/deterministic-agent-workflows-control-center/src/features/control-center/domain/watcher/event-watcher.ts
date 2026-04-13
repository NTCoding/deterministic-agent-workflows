import type { ParsedEvent } from '../query/query-types'
import type { SessionQueryDeps } from '../query/session-queries'
import {
  getMaxSeq, getEventsSinceSeq 
} from '../query/session-queries'

/** @riviere-role value-object */
export type EventWatcherDeps = {
  readonly queryDeps: SessionQueryDeps
  readonly onNewEvents: (events: ReadonlyArray<ParsedEvent>) => void
  readonly pollIntervalMs?: number
}

/** @riviere-role value-object */
export type EventWatcher = {
  readonly start: () => void
  readonly stop: () => void
  readonly isRunning: () => boolean
  readonly lastSeenSeq: () => number
}

/** @riviere-role domain-service */
export function createEventWatcher(deps: EventWatcherDeps): EventWatcher {
  const pollInterval = deps.pollIntervalMs ?? 500
  const state: {
    interval: ReturnType<typeof setInterval> | undefined
    currentSeq: number
    running: boolean
  } = {
    interval: undefined,
    currentSeq: 0,
    running: false,
  }

  function poll(): void {
    try {
      const newEvents = getEventsSinceSeq(deps.queryDeps, state.currentSeq)
      if (newEvents.length > 0) {
        const maxSeq = Math.max(...newEvents.map((event) => event.seq))
        state.currentSeq = maxSeq
        deps.onNewEvents(newEvents)
      }
    } catch {
      /* SQLite busy — retry next poll */
    }
  }

  return {
    start() {
      if (state.running) return
      state.running = true
      state.currentSeq = getMaxSeq(deps.queryDeps)
      state.interval = setInterval(poll, pollInterval)
    },

    stop() {
      if (!state.running) return
      state.running = false
      if (state.interval) {
        clearInterval(state.interval)
        state.interval = undefined
      }
    },

    isRunning() {
      return state.running
    },

    lastSeenSeq() {
      return state.currentSeq
    },
  }
}
