import {
  describe,
  expect,
  it,
} from 'vitest'
import type { SessionSummaryDto } from '../api-client'
import { formatLocalTimestamp } from '../render'
import {
  renderSessionList,
  renderSessionRow,
} from './session-row'

function makeSession(startedAt?: string): SessionSummaryDto {
  return {
    sessionId: 'session-12345678',
    currentState: 'DEVELOPING',
    workflowStates: ['PLANNING', 'DEVELOPING'],
    status: 'active',
    totalEvents: 3,
    startedAt,
    firstEventAt: '2026-01-01T00:00:00Z',
    lastEventAt: '2026-01-01T00:02:00Z',
    durationMs: 120_000,
    activeAgents: [],
    transitionCount: 1,
    permissionDenials: {
      write: 0,
      bash: 0,
      pluginRead: 0,
      idle: 0,
    },
  }
}

describe('renderSessionRow', () => {
  it('shows the locally formatted session-started date and time', () => {
    const startedAt = '2026-01-02T15:04:00Z'

    const row = renderSessionRow(makeSession(startedAt))

    expect(row).toContain('Started')
    expect(row).toContain(formatLocalTimestamp(startedAt))
  })

  it('shows a placeholder when no session-started event is available', () => {
    expect(renderSessionRow(makeSession())).toContain('Started</span>-')
  })

  it('renders visible headers with a shared Started column', () => {
    const list = renderSessionList([makeSession('2026-01-02T15:04:00Z')])

    expect(list).toContain('class="session-list-header"')
    expect(list).toContain('<span>Started</span>')
    expect(list).toContain('class="session-started"')
  })
})
