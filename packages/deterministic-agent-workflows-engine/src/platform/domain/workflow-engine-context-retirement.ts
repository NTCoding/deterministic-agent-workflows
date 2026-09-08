import type { ContextRetiredEvent } from './engine-events'
import type {
  EngineResult,
  WorkflowEventStore,
} from './workflow-engine-types'
import { contextRetiredSchema } from './engine-events'
import { flattenStoredEvent } from './stored-event'
import { requireNonEmptyString } from './non-empty-string'
import {
  formatContextRetiredSuccess,
  formatRetiredContextError,
} from '../infra/cli/presentation/output-guidance'

/** @riviere-role value-object */
export interface WorkflowContextRetirementDeps {
  readonly store: WorkflowEventStore
  readonly resolveSessionId: (sessionId: string) => string
  readonly now: () => string
  readonly persistPlatformEvent: (sessionId: string, event: unknown) => void
}

/** @riviere-role domain-service */
export function createWorkflowContextRetirement(deps: WorkflowContextRetirementDeps) {
  const readRetirement = (resolvedSessionId: string): ContextRetiredEvent | undefined => {
    const events = deps.store.readEvents(resolvedSessionId)
    const retirements = events
      .filter((event) => event.envelope.type === 'context-retired')
      .map((event) => contextRetiredSchema.parse(flattenStoredEvent(event)))
    return retirements[retirements.length - 1]
  }

  return {
    retire(sessionId: string, reason: string, successorSessionId?: string): EngineResult {
      const callingSessionId = requireNonEmptyString(sessionId, 'sessionId')
      const resolved = deps.resolveSessionId(callingSessionId)
      const existing = readRetirement(resolved)
      if (existing?.hostSessionId === callingSessionId) {
        return {
          type: 'success',
          output: formatContextRetiredSuccess('retire-context', existing.at),
        }
      }
      deps.persistPlatformEvent(resolved, {
        type: 'context-retired',
        at: deps.now(),
        hostSessionId: callingSessionId,
        reason: requireNonEmptyString(reason, 'reason'),
        ...(successorSessionId === undefined ? {} : { successorSessionId }),
      })
      return {
        type: 'success',
        output: formatContextRetiredSuccess('retire-context', deps.now()),
      }
    },

    get(sessionId: string): ContextRetiredEvent | undefined {
      return readRetirement(deps.resolveSessionId(sessionId))
    },

    gate(callingSessionId: string, op: string): EngineResult | undefined {
      const retirement = readRetirement(deps.resolveSessionId(callingSessionId))
      if (retirement?.hostSessionId !== callingSessionId) return undefined
      return {
        type: 'blocked',
        output: formatRetiredContextError(op, retirement.at),
      }
    },
  }
}
