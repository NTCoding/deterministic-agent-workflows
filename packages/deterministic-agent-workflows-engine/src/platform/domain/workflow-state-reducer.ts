import { isPlatformOwnedEventExcludedFromWorkflowState } from './engine-events'
import {
  flattenStoredEvent,
  type StoredEvent,
} from './stored-event'
import type { BaseWorkflowState } from './workflow-state'
import type {
  RehydratableWorkflow,
  WorkflowDefinition,
} from './workflow-engine-types'

/** @riviere-role domain-service */
export function reduceWorkflowStateFromStoredEvents<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(
  workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>,
  storedEvents: readonly StoredEvent[],
): TState {
  return storedEvents
    .map(flattenStoredEvent)
    .filter((event) => !isPlatformOwnedEventExcludedFromWorkflowState(event.type))
    .reduce(
      (workflowState, event) => workflowDefinition.fold(workflowState, event),
      workflowDefinition.initialState(),
    )
}
