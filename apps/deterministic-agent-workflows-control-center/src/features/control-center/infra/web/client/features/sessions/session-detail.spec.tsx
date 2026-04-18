import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, screen
} from '@testing-library/react'
import { SessionDetail } from './session-detail'
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

function buildSessionDetailResponse(sessionId: string): Record<string, unknown> {
  return {
    ...buildSessionSummary({ sessionId }),
    journalEntries: [],
    insights: [],
    suggestions: [],
    statePeriods: [],
  }
}

function detailRouter(sessionId: string, detailOverrides: Record<string, unknown> = {}) {
  return (url: string): Response => {
    if (url.endsWith('/events')) {
      return jsonResponse({
        events: [],
        total: 0
      })
    }
    if (url.endsWith('/reflections')) {
      return jsonResponse({ reflections: [] })
    }
    return jsonResponse({
      ...buildSessionDetailResponse(sessionId),
      ...detailOverrides,
    })
  }
}

describe('SessionDetail', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('fetches the session by id', async () => {
    const fetchMock = stubFetch(detailRouter('sess-42'))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDetail sessionId="sess-42" />
      </QueryWrapper>,
    )

    await screen.findByText('sess-42')
    const calls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calls).toContain('/api/sessions/sess-42')
  })

  it('shows loading indicator while fetching', () => {
    stubFetch(() => new Promise(() => undefined))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDetail sessionId="sess-loading" />
      </QueryWrapper>,
    )

    expect(screen.getByRole('status', { name: /loading session/i })).toBeInTheDocument()
  })

  it('renders the session id as heading and a StateBadge', async () => {
    stubFetch(detailRouter('sess-with-state', { currentState: 'DEVELOPING' }))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDetail sessionId="sess-with-state" />
      </QueryWrapper>,
    )

    const heading = await screen.findByRole('heading', {
      name: /sess-with-state/i,
      level: 1,
    })
    expect(heading).toBeInTheDocument()
    expect(screen.getByLabelText('State: DEVELOPING')).toHaveTextContent('DEV')
  })

  it('shows an error message when the fetch fails', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDetail sessionId="sess-err" />
      </QueryWrapper>,
    )

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(/failed to load session/i)
  })

  it('shows a not-found message when the session returns 404', async () => {
    stubFetch(() => new Response('not found', { status: 404 }))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <SessionDetail sessionId="sess-missing" />
      </QueryWrapper>,
    )

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(/session.*not found/i)
  })
})
