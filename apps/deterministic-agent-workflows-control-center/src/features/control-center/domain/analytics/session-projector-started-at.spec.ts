import {
  describe,
  expect,
  it,
} from 'vitest'
import type { ParsedEvent } from '../query/query-types'
import { projectSession } from './session-projector'

describe('projectSession start time', () => {
  it('records the first session-started event timestamp without requiring a valid payload', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'branch-recorded',
        at: '2026-01-01T00:00:00Z',
        payload: { branch: 'feat/example' },
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:01:00Z',
        payload: {},
      },
      {
        seq: 3,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:02:00Z',
        payload: {},
      },
    ]

    expect(projectSession('s1', events).startedAt).toBe('2026-01-01T00:01:00Z')
  })
})
