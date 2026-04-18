import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, screen, waitFor
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionDashboard } from './session-dashboard'
import {
  createTestQueryClient,
  QueryWrapper,
  buildSessionSummary,
} from './session-list-test-fixtures'

type FetchMock = ReturnType<typeof vi.fn>

function stubFetch(responder: (url: string) => Response | Promise<Response>): FetchMock {
  const mock = vi.fn(async (input: Request | string | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    return await responder(url)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SessionDashboard', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders a heading naming the dashboard', async () => {
    stubFetch(() =>
      jsonResponse({
        sessions: [],
        total: 0
      }),
    )
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDashboard />
      </QueryWrapper>,
    )

    expect(screen.getByRole('heading', {
      name: /sessions/i,
      level: 1 
    })).toBeInTheDocument()
  })

  it('fetches sessions with the default "all" filter on first render', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        sessions: [],
        total: 0
      }),
    )
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDashboard />
      </QueryWrapper>,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions')
    })
  })

  it('refetches with a new filter when the user changes status', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        sessions: [buildSessionSummary({ sessionId: 'sess-visible' })],
        total: 1,
      }),
    )
    const client = createTestQueryClient()
    const user = userEvent.setup()

    render(
      <QueryWrapper client={client}>
        <SessionDashboard />
      </QueryWrapper>,
    )

    await screen.findByText('sess-visible')

    await user.click(screen.getByRole('radio', { name: /active/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions?status=active')
    })
  })
})
