import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest'
import {
  render, screen,
} from '@testing-library/react'
import {
  RouterProvider, createRouter, createMemoryHistory,
} from '@tanstack/react-router'
import {
  QueryClient, QueryClientProvider,
} from '@tanstack/react-query'
import { routeTree } from '../routeTree.gen'
import {
  buildSessionSummary, createTestQueryClient,
} from '../features/sessions/session-list-test-fixtures'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildSessionDetail(sessionId: string): Record<string, unknown> {
  return {
    ...buildSessionSummary({ sessionId }),
    journalEntries: [],
    insights: [],
    suggestions: [],
    statePeriods: [],
  }
}

function buildAnalyticsOverview(): Record<string, unknown> {
  return {
    totalSessions: 3,
    activeSessions: 1,
    completedSessions: 2,
    staleSessions: 0,
    averageDurationMs: 0,
    averageTransitionCount: 0,
    averageDenialCount: 0,
    totalEvents: 5,
    denialHotspots: [],
    stateTimeDistribution: [],
  }
}

function fetchRouter(url: string): Response {
  if (url === '/api/sessions' || url.startsWith('/api/sessions?')) {
    return jsonResponse({ sessions: [] })
  }
  if (url === '/api/analytics/overview') {
    return jsonResponse(buildAnalyticsOverview())
  }
  if (url.startsWith('/api/analytics/compare')) {
    return jsonResponse({
      sessionA: buildSessionDetail('sess-a'),
      sessionB: buildSessionDetail('sess-b'),
    })
  }
  if (url.endsWith('/events')) {
    return jsonResponse({
      events: [],
      total: 0,
    })
  }
  if (url.endsWith('/reflections')) {
    return jsonResponse({ reflections: [] })
  }
  const match = /\/api\/sessions\/([^/?]+)$/.exec(url)
  if (match) {
    return jsonResponse(buildSessionDetail(match[1] ?? 'sess-x'))
  }
  return new Response('not found', { status: 404 })
}

async function renderAtPath(path: string, client: QueryClient): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('routes integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: Request | string | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      return fetchRouter(url)
    }))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('renders the dashboard at /', async () => {
    await renderAtPath('/', createTestQueryClient())
    const heading = await screen.findByRole('heading', {
      name: /sessions/i,
      level: 1,
    })
    expect(heading).toBeInTheDocument()
  })

  it('renders the session detail at /session/:id', async () => {
    await renderAtPath('/session/sess-42', createTestQueryClient())
    const heading = await screen.findByRole('heading', {
      name: /sess-42/i,
      level: 1,
    })
    expect(heading).toBeInTheDocument()
  })

  it('renders the analytics overview at /analytics', async () => {
    await renderAtPath('/analytics', createTestQueryClient())
    const heading = await screen.findByRole('heading', {
      name: /analytics/i,
      level: 1,
    })
    expect(heading).toBeInTheDocument()
  })

  it('renders the comparison view at /compare/:a/:b', async () => {
    await renderAtPath('/compare/sess-a/sess-b', createTestQueryClient())
    const heading = await screen.findByRole('heading', {
      name: /compare/i,
      level: 1,
    })
    expect(heading).toBeInTheDocument()
  })

  it('renders the not-found page for unknown routes', async () => {
    await renderAtPath('/does-not-exist', createTestQueryClient())
    expect(await screen.findByRole('alert')).toHaveTextContent(/page not found/i)
  })
})
