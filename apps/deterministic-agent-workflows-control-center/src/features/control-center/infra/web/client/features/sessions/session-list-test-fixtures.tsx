import type { ReactNode } from 'react'
import {
  QueryClient, QueryClientProvider 
} from '@tanstack/react-query'
import type { SessionSummary } from '../../api/schemas'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0 
      },
      mutations: { retry: false },
    },
  })
}

type WrapperProps = Readonly<{
  client: QueryClient
  children: ReactNode
}>

export function QueryWrapper({
  client, children 
}: WrapperProps): React.JSX.Element {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export function buildSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'sess-abc123',
    currentState: 'PLANNING',
    workflowStates: ['PLANNING'],
    status: 'active',
    totalEvents: 10,
    firstEventAt: '2026-01-01T10:00:00Z',
    lastEventAt: '2026-01-01T10:30:00Z',
    durationMs: 1_800_000,
    activeAgents: ['developer'],
    transitionCount: 2,
    permissionDenials: {
      write: 0,
      bash: 0,
      pluginRead: 0,
      idle: 0,
    },
    ...overrides,
  }
}
