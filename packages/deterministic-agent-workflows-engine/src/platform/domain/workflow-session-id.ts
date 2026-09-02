import type {
  SessionContext,
  WorkflowEventStore,
} from './workflow-engine-types'

/** @riviere-role domain-service */
export async function getWorkflowSessionId(
  store: Pick<WorkflowEventStore, 'hasSessionStarted'>,
  executingSessionId: string,
  sessionContext: SessionContext,
): Promise<string> {
  if (store.hasSessionStarted(executingSessionId)) {
    return executingSessionId
  }
  return sessionContext.getMainSessionId()
}
