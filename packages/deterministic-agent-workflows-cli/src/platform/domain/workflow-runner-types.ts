import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  WorkflowDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { BashForbiddenConfig } from '@nt-ai-lab/deterministic-agent-workflow-dsl'
import type { RouteMap } from './command-definition'
import type {
  CustomPreToolUseGate,
  PreToolUseHandlerFn,
} from './pre-tool-use-handler'

/** @riviere-role value-object */
export type RunnerResult = {
  readonly output: string;
  readonly exitCode: number
}

/** @riviere-role value-object */
export type RunnerOptions = {
  readonly readStdin?: () => string
  readonly getSessionId?: () => string
  readonly getSessionTranscriptPath?: () => string
  readonly getSessionRepository?: () => string | undefined
}

/** @riviere-role value-object */
export type WorkflowRunnerConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> = {
  readonly workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>
  readonly routes: RouteMap<TWorkflow, TState>
  readonly bashForbidden?: BashForbiddenConfig
  readonly isWriteAllowed?: (filePath: string, state: TState) => boolean
  readonly customGates?: readonly CustomPreToolUseGate<TWorkflow, TState, TStateName>[]
  readonly preToolUseHandler?: PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation>
}
