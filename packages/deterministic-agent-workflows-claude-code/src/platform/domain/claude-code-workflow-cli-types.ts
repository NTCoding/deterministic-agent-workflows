import type {
  BaseWorkflowState,
  RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { WorkflowCliConfig } from '@nt-ai-lab/deterministic-agent-workflow-cli'

/** @riviere-role value-object */
export type ClaudeCodeWorkflowCliConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState,
  TDeps,
> = Omit<WorkflowCliConfig<TWorkflow, TState, TDeps>, 'transcriptReader'>
