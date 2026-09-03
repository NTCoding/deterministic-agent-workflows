import {
  describe,
  expect,
  it,
} from 'vitest'
import type { StoredEvent } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { buildDenialSummary } from './reflection-process-observations'

function denialEvent(type: string, allowed: unknown, state?: string): StoredEvent {
  return {
    envelope: {
      type,
      at: 'now',
      state,
    },
    payload: { allowed },
  }
}

describe('buildDenialSummary', () => {
  it('counts only denied checks by type and state', () => {
    const events = [
      denialEvent('write-checked', false, 'beta'),
      denialEvent('write-checked', false, 'beta'),
      denialEvent('bash-checked', false),
      denialEvent('plugin-read-checked', false, 'alpha'),
      denialEvent('idle-checked', false, 'alpha'),
      denialEvent('write-checked', true, 'ignored'),
      denialEvent('idle-checked', undefined, 'ignored'),
      denialEvent('other-check', false, 'ignored'),
    ]

    expect(buildDenialSummary(events)).toStrictEqual({
      total: 5,
      byType: {
        write: 2,
        bash: 1,
        pluginRead: 1,
        idle: 1,
      },
      byState: [
        {
          state: 'alpha',
          count: 2,
        },
        {
          state: 'beta',
          count: 2,
        },
        {
          state: 'unknown',
          count: 1,
        },
      ],
    })
  })

  it('returns zeroed denial counts for an empty event stream', () => {
    expect(buildDenialSummary([])).toStrictEqual({
      total: 0,
      byType: {
        write: 0,
        bash: 0,
        pluginRead: 0,
        idle: 0,
      },
      byState: [],
    })
  })
})
