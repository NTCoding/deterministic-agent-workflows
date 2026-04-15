import type { BaseEvent } from './base-event'

/** @riviere-role value-object */
export interface EventEnvelope {
  readonly type: string
  readonly at: string
  readonly state: string | undefined
}

/**
 * Platform wire / storage shape for events.
 *
 * Envelope fields are stamped by the platform at persist time (see
 * `WorkflowEngine.persistEvents`). Workflow authors never construct
 * `StoredEvent` directly — they call `appendEvent(BaseEvent)` with flat
 * domain events. Only the engine and direct event-store readers (e.g. the
 * control-center UI) observe this shape.
 *
 * @riviere-role value-object
 */
export interface StoredEvent {
  readonly envelope: EventEnvelope
  readonly payload: Readonly<Record<string, unknown>>
}

/** @riviere-role domain-service */
export function flattenStoredEvent(stored: StoredEvent): BaseEvent {
  return {
    ...stripEnvelopeKeys(stored.payload),
    type: stored.envelope.type,
    at: stored.envelope.at,
  }
}

/** @riviere-role domain-service */
export function toPayload(event: BaseEvent): Record<string, unknown> {
  return stripEnvelopeKeys(event)
}

/** @riviere-role domain-service */
export function stripEnvelopeKeys(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'type' || key === 'at') continue
    result[key] = value
  }
  return result
}
