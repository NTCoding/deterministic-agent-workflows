import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, screen
} from '@testing-library/react'
import { ReflectionsPanel } from './reflections-panel'
import {
  createTestQueryClient, QueryWrapper,
} from './session-list-test-fixtures'

function stubFetch(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })))
}

describe('ReflectionsPanel', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders one group per reflection with its findings', async () => {
    stubFetch({
      reflections: [
        {
          id: 1,
          createdAt: '2026-01-01T00:10:00Z',
          reflection: {
            findings: [
              {
                type: 'missed-test',
                description: 'No test for negative price'
              },
              {
                type: 'unclear-naming',
                description: 'Variable named data'
              },
            ],
          },
        },
      ],
    })
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <ReflectionsPanel sessionId="s1" />
      </QueryWrapper>,
    )

    await screen.findByText(/no test for negative price/i)
    expect(screen.getByText(/variable named data/i)).toBeInTheDocument()
    expect(screen.getByText(/missed-test/i)).toBeInTheDocument()
  })

  it('shows loading state while the reflections request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <ReflectionsPanel sessionId="s-loading" />
      </QueryWrapper>,
    )

    expect(screen.getByRole('status', { name: /loading reflections/i })).toBeInTheDocument()
  })

  it('shows an error message when the reflections request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <ReflectionsPanel sessionId="s-err" />
      </QueryWrapper>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to load reflections/i)
  })

  it('shows empty state when no reflections', async () => {
    stubFetch({ reflections: [] })
    const client = createTestQueryClient()

    render(
      <QueryWrapper client={client}>
        <ReflectionsPanel sessionId="s1" />
      </QueryWrapper>,
    )

    expect(await screen.findByText(/no reflections recorded/i)).toBeInTheDocument()
  })
})
