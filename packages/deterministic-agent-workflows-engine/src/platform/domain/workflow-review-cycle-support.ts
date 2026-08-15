import { flattenStoredEvent } from './stored-event'
import { WorkflowStateError } from './workflow-state'
import type { WorkflowEventStore } from './workflow-engine-types'

/** @riviere-role domain-service */
export function sameReviewTypes(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === actual.length
    && new Set(expected).size === expected.length
    && new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value))
}

/** @riviere-role domain-service */
export function getLatestReviewCommit(store: WorkflowEventStore, sessionId: string): string | undefined {
  const event = store.readEvents(sessionId)
    .map(flattenStoredEvent)
    .reverse()
    .find((candidate) => candidate.type === 'review-cycle-started')
  return typeof event?.reviewedCommit === 'string' && event.reviewedCommit.length > 0
    ? event.reviewedCommit
    : undefined
}

/** @riviere-role domain-service */
export function getSessionRepository(store: WorkflowEventStore, sessionId: string): string {
  const event = store.readEvents(sessionId)
    .map(flattenStoredEvent)
    .find((candidate) => candidate.type === 'session-started')
  if (typeof event?.repository !== 'string' || event.repository.length === 0) {
    throw new WorkflowStateError(`Session '${sessionId}' has no repository metadata.`)
  }
  return event.repository
}
