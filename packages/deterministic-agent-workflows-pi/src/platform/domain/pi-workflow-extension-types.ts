import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  ReviewBundleRequest,
  TransitionContext,
  WorkflowDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  PlatformContext,
  PreToolUseHandlerConfig,
  RouteMap,
  ReviewAgentClient,
  ReviewCoordinatorResult,
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
export interface PiWorkflowIdleContext<TState> {
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly workingDirectory: string
  getState(): TState
  runOperation(operation: string, ...args: readonly string[]): string
  runReviews(request: Omit<ReviewBundleRequest, 'sessionId' | 'workingDirectory'>, client: ReviewAgentClient): Promise<ReviewCoordinatorResult>
  resumeWithFreshContext(stateInstructions: string): void
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
  readonly unknownCommandMessage: string
  readonly buildWorkflowDeps: (platform: PlatformContext) => TDeps
  readonly pluginRoot: string
  readonly databasePath?: string
  readonly commandName?: string
  readonly toolName?: string
  readonly stopPreventionMessage?: string
  readonly automation?: {
    readonly ownsState: (state: TState) => boolean
    readonly onIdle: (context: PiWorkflowIdleContext<TState>) => Promise<void>
  }
}
