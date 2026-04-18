import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, screen
} from '@testing-library/react'
import { AnalyticsOverview } from './analytics-overview'
import {
  createTestQueryClient, QueryWrapper,
} from '../sessions/session-list-test-fixtures'

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

const baseOverview = {
  totalSessions: 12,
  activeSessions: 3,
  completedSessions: 8,
  staleSessions: 1,
  averageDurationMs: 600_000,
  averageTransitionCount: 5,
  averageDenialCount: 2,
  totalEvents: 400,
  denialHotspots: [],
  stateTimeDistribution: [],
}

describe('AnalyticsOverview', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders the headline totals from the overview payload', async () => {
    stubFetch(baseOverview)
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <AnalyticsOverview />
      </QueryWrapper>,
    )

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('400')).toBeInTheDocument()
    expect(screen.getByText(/total sessions/i)).toBeInTheDocument()
    expect(screen.getByText(/total events/i)).toBeInTheDocument()
  })

  it('shows an error message when the fetch fails', async () => {
    stubFetch({}, 500)
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <AnalyticsOverview />
      </QueryWrapper>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to load analytics/i)
  })
})
