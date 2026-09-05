import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  TransitionContext,
  WorkflowDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  PlatformContext,
  PreToolUseHandlerConfig,
  RouteMap,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'

/** @riviere-role value-object */
export type PiWorkflowExtension = ExtensionFactory

/** @riviere-role value-object */
export type PiInitializationStatus =
  | { readonly type: 'inactive' }
  | { readonly type: 'initializing' }
  | { readonly type: 'ready' }
  | {
    readonly type: 'failed';
    readonly reason: string
  }

/** @riviere-role value-object */
export type PiSessionIdResult =
  | {
    readonly ok: true;
    readonly sessionId: string
  }
  | {
    readonly ok: false;
    readonly reason: string
  }

/** @riviere-role value-object */
export type PiWorkflowExtensionConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
  TTransitionContext extends TransitionContext<TState, TStateName> = TransitionContext<TState, TStateName>,
> = Omit<PreToolUseHandlerConfig<TWorkflow, TState, TStateName>, 'questionToolName'> & {
  readonly workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>
  readonly routes: RouteMap<TWorkflow, TState>
  readonly buildWorkflowDeps: (platform: PlatformContext) => TDeps
  readonly pluginRoot: string
  readonly databasePath?: string
  readonly commandName?: string
  readonly toolName?: string
  readonly stopPreventionMessage?: string
}
