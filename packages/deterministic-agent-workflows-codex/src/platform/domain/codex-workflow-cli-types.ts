import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  TranscriptReader,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  ProcessDeps,
  WorkflowRunnerConfig,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type { PlatformContext } from '@nt-ai-lab/deterministic-agent-workflow-cli'

/** @riviere-role value-object */
export type CodexWorkflowCliConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> = WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation> & {
  readonly buildWorkflowDeps: (platform: PlatformContext) => TDeps
  readonly processDeps: ProcessDeps
  readonly workflowCommand: string
  readonly workflowRoot?: string
  readonly transcriptReader?: TranscriptReader
}
