import {
  describe, it, expect, beforeEach, afterEach, vi 
} from 'vitest'
import {
  render, screen, waitFor 
} from '@testing-library/react'
import { SessionList } from './session-list'
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

describe('SessionList', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows loading indicator while fetching', () => {
    stubFetch(() => new Promise(() => undefined))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionList filter="all" />
      </QueryWrapper>,
    )

    expect(screen.getByRole('status', { name: /loading sessions/i })).toBeInTheDocument()
  })

  it('shows empty message when no sessions returned', async () => {
    stubFetch(() => jsonResponse({
      sessions: [],
      total: 0 
    }))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionList filter="all" />
      </QueryWrapper>,
    )

    const empty = await screen.findByText(/no sessions found/i)
    expect(empty).toBeInTheDocument()
  })

  it('renders one row per session with the sessionId', async () => {
    stubFetch(() =>
      jsonResponse({
        sessions: [
          buildSessionSummary({ sessionId: 'sess-first' }),
          buildSessionSummary({ sessionId: 'sess-second' }),
        ],
        total: 2,
      }),
    )
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionList filter="all" />
      </QueryWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('sess-first')).toBeInTheDocument()
    })
    expect(screen.getByText('sess-second')).toBeInTheDocument()
  })

  it('renders a StateBadge for each session currentState', async () => {
    stubFetch(() =>
      jsonResponse({
        sessions: [buildSessionSummary({ currentState: 'DEVELOPING' })],
        total: 1,
      }),
    )
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionList filter="all" />
      </QueryWrapper>,
    )

    const badge = await screen.findByLabelText('State: DEVELOPING')
    expect(badge).toHaveTextContent('DEV')
  })

  it('shows an error message when fetching fails', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionList filter="all" />
      </QueryWrapper>,
    )

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(/failed to load sessions/i)
  })

  it('passes the filter into the fetch URL', async () => {
    const fetchMock = stubFetch(() => jsonResponse({
      sessions: [],
      total: 0 
    }))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionList filter="active" />
      </QueryWrapper>,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions?status=active')
    })
  })
})
