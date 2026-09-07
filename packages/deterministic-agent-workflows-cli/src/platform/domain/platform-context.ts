import type {
  ReviewJobStore,
  WorkflowEventStore,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'

/** @riviere-role value-object */
export type PlatformContext = {
  readonly getPluginRoot: () => string
  readonly now: () => string
  readonly getSessionId: () => string
  readonly workflowEventStore: WorkflowEventStore
  readonly reviewStore: ReviewJobStore
}
