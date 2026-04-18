import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, screen
} from '@testing-library/react'
import { TranscriptView } from './transcript-view'
import {
  createTestQueryClient, QueryWrapper,
} from './session-list-test-fixtures'

function stubFetch(body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('TranscriptView', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders an event row per fetched event', async () => {
    stubFetch({
      events: [
        {
          seq: 1,
          sessionId: 's1',
          type: 'session-started',
          recordedAt: '2026-01-01T00:00:00Z',
          payload: {},
          state: 'SPAWN',
          category: 'session',
          detail: 'Session started',
          denied: false,
        },
        {
          seq: 2,
          sessionId: 's1',
          type: 'transitioned',
          recordedAt: '2026-01-01T00:01:00Z',
          payload: {},
          state: 'PLAN',
          category: 'transition',
          detail: 'SPAWN → PLAN',
          denied: false,
        },
      ],
      total: 2,
    })
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <TranscriptView sessionId="s1" />
      </QueryWrapper>,
    )

    await screen.findByText('session-started')
    expect(screen.getByText('transitioned')).toBeInTheDocument()
    expect(screen.getByText('Session started')).toBeInTheDocument()
    expect(screen.getByText('SPAWN → PLAN')).toBeInTheDocument()
  })

  it('shows loading state while the events request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <TranscriptView sessionId="s-loading" />
      </QueryWrapper>,
    )

    expect(screen.getByRole('status', { name: /loading transcript/i })).toBeInTheDocument()
  })

  it('shows an error message when the events request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <TranscriptView sessionId="s-err" />
      </QueryWrapper>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to load transcript/i)
  })

  it('shows empty state when no events returned', async () => {
    stubFetch({
      events: [],
      total: 0
    })
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <TranscriptView sessionId="s1" />
      </QueryWrapper>,
    )

    expect(await screen.findByText(/no events recorded yet/i)).toBeInTheDocument()
  })
})
