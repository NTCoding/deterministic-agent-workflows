/** @riviere-role web-tbc */
export type SseClientCallbacks = {
  onNewEvent?: (data: Record<string, unknown>) => void
  onStateChange?: (data: {
    sessionId: string;
    currentState: string;
    previousState: string 
  }) => void
  onSessionStarted?: (data: { sessionId: string }) => void
  onConnected?: () => void
}

function parseMessageData<T>(event: MessageEvent, predicate: (value: unknown) => value is T): T | undefined {
  if (typeof event.data !== 'string') {
    return undefined
  }

  const parsed: unknown = JSON.parse(event.data)
  return predicate(parsed) ? parsed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStateChangePayload(value: unknown): value is {
  sessionId: string;
  currentState: string;
  previousState: string 
} {
  return isRecord(value)
    && typeof value['sessionId'] === 'string'
    && typeof value['currentState'] === 'string'
    && typeof value['previousState'] === 'string'
}

function isSessionStartedPayload(value: unknown): value is { sessionId: string } {
  return isRecord(value) && typeof value['sessionId'] === 'string'
}

/** @riviere-role web-tbc */
export function createSseClient(callbacks: SseClientCallbacks, sessionFilter?: string): EventSource {
  const url = sessionFilter ? `/events?session=${sessionFilter}` : '/events'
  const source = new EventSource(url)

  source.addEventListener('connected', () => {
    callbacks.onConnected?.()
  })

  source.addEventListener('new-event', (e: MessageEvent) => {
    const data = parseMessageData(e, isRecord)
    if (data !== undefined) {
      callbacks.onNewEvent?.(data)
    }
  })

  source.addEventListener('state-change', (e: MessageEvent) => {
    const data = parseMessageData(e, isStateChangePayload)
    if (data !== undefined) {
      callbacks.onStateChange?.(data)
    }
  })

  source.addEventListener('session-started', (e: MessageEvent) => {
    const data = parseMessageData(e, isSessionStartedPayload)
    if (data !== undefined) {
      callbacks.onSessionStarted?.(data)
    }
  })

  return source
}
