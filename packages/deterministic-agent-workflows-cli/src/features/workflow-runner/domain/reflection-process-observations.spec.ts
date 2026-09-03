import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { StoredEvent } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  buildObservedEventTypes,
  buildStateDurationSummary,
  buildTransitionSummary,
  computeStatePeriods,
} from './reflection-process-observations'
import type { StatePeriod } from './reflection-process-types'

function event(
  type: string,
  at: string,
  payload: Readonly<Record<string, unknown>>,
  state?: string,
): StoredEvent {
  return {
    envelope: {
      type,
      at,
      state,
    },
    payload,
  }
}

describe('computeStatePeriods', () => {
  it('returns no periods without workflow events', () => {
    expect(computeStatePeriods([], 'CURRENT')).toStrictEqual([])
  })

  it('uses session start state and records valid transitions and durations', () => {
    const events = [
      event('metadata', '2026-09-01T09:59:59.000Z', {}),
      event('session-started', '2026-09-01T10:00:00.000Z', { currentState: 'PLANNING' }),
      event('write-checked', '2026-09-01T10:00:01.000Z', { allowed: true }),
      event('transitioned', '2026-09-01T10:00:02.000Z', {
        from: 'PLANNING',
        to: 'DEVELOPING'
      }),
      event('transitioned', '2026-09-01T10:00:05.000Z', {
        from: 'DEVELOPING',
        to: 'REVIEWING'
      }),
      event('review-recorded', '2026-09-01T10:00:09.000Z', {}),
    ]

    expect(computeStatePeriods(events, 'CURRENT')).toStrictEqual([
      {
        state: 'PLANNING',
        startedAt: '2026-09-01T10:00:00.000Z',
        endedAt: '2026-09-01T10:00:02.000Z',
        durationMs: 2000,
      },
      {
        state: 'DEVELOPING',
        startedAt: '2026-09-01T10:00:02.000Z',
        endedAt: '2026-09-01T10:00:05.000Z',
        durationMs: 3000,
      },
      {
        state: 'REVIEWING',
        startedAt: '2026-09-01T10:00:05.000Z',
        endedAt: '2026-09-01T10:00:09.000Z',
        durationMs: 4000,
      },
    ])
  })

  it('falls back to current state, ignores malformed transitions, and clamps negative durations', () => {
    const events = [
      event('session-started', '2026-09-01T10:00:10.000Z', { currentState: '' }),
      event('transitioned', '2026-09-01T10:00:08.000Z', { to: 42 }),
      event('transitioned', '2026-09-01T10:00:07.000Z', { to: '' }),
      event('transitioned', '2026-09-01T10:00:05.000Z', { to: 'DEVELOPING' }),
      event('completed', 'invalid timestamp', {}),
    ]

    expect(computeStatePeriods(events, 'CURRENT')).toStrictEqual([
      {
        state: 'CURRENT',
        startedAt: '2026-09-01T10:00:10.000Z',
        endedAt: '2026-09-01T10:00:05.000Z',
        durationMs: 0,
      },
      {
        state: 'DEVELOPING',
        startedAt: '2026-09-01T10:00:05.000Z',
        endedAt: 'invalid timestamp',
        durationMs: 0,
      },
    ])
  })

  it('uses the first event and current state when session metadata is absent or malformed', () => {
    const events = [
      event('metadata', '2026-09-01T10:00:00.000Z', { currentState: 7 }),
      event('completed', '2026-09-01T10:00:01.000Z', {}),
    ]

    expect(computeStatePeriods(events, 'RECOVERING')).toStrictEqual([{
      state: 'RECOVERING',
      startedAt: '2026-09-01T10:00:00.000Z',
      endedAt: '2026-09-01T10:00:01.000Z',
      durationMs: 1000,
    }])
  })
})

describe('buildObservedEventTypes', () => {
  it('counts types and combines sorted payload keys in deterministic order', () => {
    const events = [
      event('zeta', 'now', { second: true }),
      event('alpha', 'now', { only: true }),
      event('zeta', 'now', { first: true }),
      event('alpha', 'now', { another: true }),
      event('beta', 'now', {}),
    ]

    expect(buildObservedEventTypes(events)).toStrictEqual([
      {
        type: 'alpha',
        count: 2,
        payloadKeys: ['another', 'only']
      },
      {
        type: 'zeta',
        count: 2,
        payloadKeys: ['first', 'second']
      },
      {
        type: 'beta',
        count: 1,
        payloadKeys: []
      },
    ])
  })

  it('returns no observed types for an empty event stream', () => {
    expect(buildObservedEventTypes([])).toStrictEqual([])
  })

  it('defaults payload keys when a dynamic event type changes during observation', () => {
    const observedTypes = ['orphan', 'orphan', 'orphan', 'different']
    const dynamicEvent: StoredEvent = {
      envelope: {
        get type() {
          return observedTypes.shift() ?? 'different'
        },
        at: 'now',
        state: undefined,
      },
      payload: { key: true },
    }

    expect(buildObservedEventTypes([dynamicEvent])).toStrictEqual([{
      type: 'orphan',
      count: 1,
      payloadKeys: [],
    }])
  })
})

describe('buildStateDurationSummary', () => {
  it('aggregates repeated states and sorts durations with deterministic ties', () => {
    const periods: readonly StatePeriod[] = [
      {
        state: 'beta',
        startedAt: '0',
        endedAt: '1',
        durationMs: 100
      },
      {
        state: 'alpha',
        startedAt: '1',
        endedAt: '2',
        durationMs: 40
      },
      {
        state: 'alpha',
        startedAt: '2',
        endedAt: '3',
        durationMs: 60
      },
      {
        state: 'zero',
        startedAt: '3',
        endedAt: '3',
        durationMs: 0
      },
    ]

    expect(buildStateDurationSummary(periods)).toStrictEqual({
      totalDurationMs: 200,
      states: [
        {
          state: 'alpha',
          durationMs: 100,
          percentageOfSession: 50,
          entryCount: 2
        },
        {
          state: 'beta',
          durationMs: 100,
          percentageOfSession: 50,
          entryCount: 1
        },
        {
          state: 'zero',
          durationMs: 0,
          percentageOfSession: 0,
          entryCount: 1
        },
      ],
    })
  })

  it('reports zero percentage when all observed durations are zero', () => {
    expect(buildStateDurationSummary([{
      state: 'PLANNING',
      startedAt: 'same',
      endedAt: 'same',
      durationMs: 0,
    }])).toStrictEqual({
      totalDurationMs: 0,
      states: [{
        state: 'PLANNING',
        durationMs: 0,
        percentageOfSession: 0,
        entryCount: 1,
      }],
    })
  })

  it('returns an empty state summary when no periods exist', () => {
    expect(buildStateDurationSummary([])).toStrictEqual({
      totalDurationMs: 0,
      states: [],
    })
  })
})

describe('buildTransitionSummary', () => {
  it('counts valid transitions and identifies repeated three-state paths', () => {
    const transitions = [
      ['alpha', 'beta'], ['beta', 'charlie'],
      ['alpha', 'beta'], ['beta', 'charlie'],
      ['delta', 'echo'], ['echo', 'foxtrot'],
      ['delta', 'echo'], ['echo', 'foxtrot'],
      ['delta', 'echo'], ['echo', 'foxtrot'],
      ['alpha', 'beta'], ['beta', 'charlie'],
      ['xray', 'yankee'], ['xray', 'zulu'],
    ].map(([from, to]) => event('transitioned', 'now', {
      from,
      to
    }))
    const events = [
      event('write-checked', 'now', {
        from: 'ignored',
        to: 'ignored'
      }),
      event('transitioned', 'now', {
        from: 1,
        to: 'ignored'
      }),
      event('transitioned', 'now', {
        from: 'ignored',
        to: null
      }),
      ...transitions,
    ]

    expect(buildTransitionSummary(events)).toStrictEqual({
      transitions: [
        {
          from: 'alpha',
          to: 'beta',
          count: 3
        },
        {
          from: 'beta',
          to: 'charlie',
          count: 3
        },
        {
          from: 'delta',
          to: 'echo',
          count: 3
        },
        {
          from: 'echo',
          to: 'foxtrot',
          count: 3
        },
        {
          from: 'xray',
          to: 'yankee',
          count: 1
        },
        {
          from: 'xray',
          to: 'zulu',
          count: 1
        },
      ],
      repeatedPaths: [
        {
          path: ['alpha', 'beta', 'charlie'],
          count: 3
        },
        {
          path: ['delta', 'echo', 'foxtrot'],
          count: 3
        },
        {
          path: ['echo', 'foxtrot', 'echo'],
          count: 2
        },
      ],
    })
  })

  it('returns empty summaries when there are no valid transitions', () => {
    expect(buildTransitionSummary([])).toStrictEqual({
      transitions: [],
      repeatedPaths: [],
    })
  })

  it('omits a repeated path when the next transition cannot be read', () => {
    const arrayAt = vi.spyOn(Array.prototype, 'at').mockReturnValueOnce(undefined)
    const summary = buildTransitionSummary([
      event('transitioned', 'now', {
        from: 'alpha',
        to: 'beta'
      }),
      event('transitioned', 'now', {
        from: 'beta',
        to: 'charlie'
      }),
    ])
    arrayAt.mockRestore()

    expect(summary).toStrictEqual({
      transitions: [
        {
          from: 'alpha',
          to: 'beta',
          count: 1
        },
        {
          from: 'beta',
          to: 'charlie',
          count: 1
        },
      ],
      repeatedPaths: [],
    })
  })

  it('defaults decoded states when an encoded transition key is malformed', () => {
    const stringSplit = vi.spyOn(String.prototype, 'split').mockReturnValueOnce([])
    const summary = buildTransitionSummary([
      event('transitioned', 'now', {
        from: 'alpha',
        to: 'beta'
      }),
    ])
    stringSplit.mockRestore()

    expect(summary).toStrictEqual({
      transitions: [{
        from: '',
        to: '',
        count: 1,
      }],
      repeatedPaths: [],
    })
  })
})
