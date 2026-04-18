import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, screen
} from '@testing-library/react'
import { SessionCompare } from './session-compare'
import {
  createTestQueryClient,
  QueryWrapper,
  buildSessionSummary,
} from '../sessions/session-list-test-fixtures'

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

function detailFrom(sessionId: string): Record<string, unknown> {
  return {
    ...buildSessionSummary({ sessionId }),
    journalEntries: [],
    insights: [],
    suggestions: [],
    statePeriods: [],
  }
}

describe('SessionCompare', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders both session ids as side-by-side columns', async () => {
    stubFetch({
      sessionA: detailFrom('sess-a'),
      sessionB: detailFrom('sess-b'),
    })
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionCompare idA="sess-a" idB="sess-b" />
      </QueryWrapper>,
    )

    expect(await screen.findByText('sess-a')).toBeInTheDocument()
    expect(screen.getByText('sess-b')).toBeInTheDocument()
  })

  it('shows an error when the compare endpoint fails', async () => {
    stubFetch({}, 500)
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionCompare idA="x" idB="y" />
      </QueryWrapper>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load comparison/i)
  })
})
