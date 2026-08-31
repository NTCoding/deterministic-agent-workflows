import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  TranscriptReader,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  PlatformContext,
  ProcessDeps,
  WorkflowRunnerConfig,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'

/** @riviere-role value-object */
export type CodexWorkflowCliConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> = Omit<WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, 'questionToolName'> & {
  readonly buildWorkflowDeps: (platform: PlatformContext) => TDeps
  readonly processDeps: ProcessDeps
  readonly workflowCommand: string
  readonly workflowRoot?: string
  readonly transcriptReader?: TranscriptReader
  readonly now?: () => string
}
