import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  WorkflowDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  PlatformContext,
  PreToolUseHandlerConfig,
  RouteMap,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type {
  Hooks,
  Plugin,
} from '@opencode-ai/plugin'

type OpenCodePluginInput = Parameters<Plugin>[0]
type OpenCodePluginOptions = Parameters<Plugin>[1]

/** @riviere-role value-object */
export type IdleEventHookDeps = {
  readonly hasSessionStarted: (sessionID: string) => boolean
  readonly isIdleAllowed: (sessionID: string) => boolean
  readonly sendIdleRecoveryPrompt: (sessionID: string) => Promise<void>
}

/** @riviere-role value-object */
export type OpenCodePlugin = (
  input?: OpenCodePluginInput,
  options?: OpenCodePluginOptions,
) => Promise<Hooks>

/** @riviere-role value-object */
export type OpenCodeWorkflowPluginConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> = PreToolUseHandlerConfig<TWorkflow, TState, TStateName> & {
  readonly workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>
  readonly buildWorkflowDeps: (platform: PlatformContext) => TDeps
  readonly pluginRoot: string
  readonly databasePath?: string
  readonly routes?: RouteMap<TWorkflow, TState>
  readonly commandDirectories?: readonly string[]
  readonly commandPrefix?: string
}
