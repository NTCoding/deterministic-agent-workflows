import {
  describe, it, expect, beforeEach, afterEach, vi
} from 'vitest'
import {
  render, act,
} from '@testing-library/react'
import {
  QueryClient, QueryClientProvider,
} from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSSE } from './use-sse'

type EventListener = (ev: MessageEvent) => void

class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  readonly url: string
  private listeners = new Map<string, Set<EventListener>>()
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

function Harness({ sessionId }: Readonly<{ sessionId: string }>): React.JSX.Element {
  useSSE(sessionId)
  return <span data-testid="harness">mounted</span>
}

function wrap(children: ReactNode, client: QueryClient): React.JSX.Element {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useSSE', () => {
  beforeEach(() => {
    FakeEventSource.instances.length = 0
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a session-scoped EventSource connection', () => {
    const client = new QueryClient()
    render(wrap(<Harness sessionId="s1" />, client))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe('/events?session=s1')
  })

  it('invalidates session queries when an event arrives', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')

    render(wrap(<Harness sessionId="s2" />, client))
    act(() => {
      FakeEventSource.instances[0]?.emit('event-appended', { sessionId: 's2' })
    })

    expect(spy).toHaveBeenCalledWith({ queryKey: ['session', 's2'] })
  })

  it('closes the EventSource when the hook unmounts', () => {
    const client = new QueryClient()
    const { unmount } = render(wrap(<Harness sessionId="s3" />, client))
    const instance = FakeEventSource.instances[0]
    unmount()
    expect(instance?.closed).toBe(true)
  })
})
