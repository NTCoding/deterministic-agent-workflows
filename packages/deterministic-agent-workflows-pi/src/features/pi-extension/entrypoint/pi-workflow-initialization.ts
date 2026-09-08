import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  TransitionContext,
  WorkflowEngine,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { getRepositoryName } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import {
  hasPiWorkflowMarker,
  PI_WORKFLOW_MARKER_CUSTOM_TYPE,
} from '../../../platform/infra/external-clients/pi/pi-session-file'
import { requireSessionFile } from './pi-workflow-extension-platform'

interface PiSessionInitializerDeps<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
  TTransitionContext extends TransitionContext<TState, TStateName>,
> {
  readonly ownership: {
    readonly usesInheritedWorkflow: (sessionId: string) => boolean
    readonly delegatedParent: (sessionId: string) => string | undefined
    readonly parentSafetyFailure: (event: SessionStartEvent, ctx: ExtensionContext) => string | undefined
  }
  readonly useEngine: <TResult>(
    ctx: ExtensionContext,
    operation: (
      engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>,
    ) => TResult,
  ) => TResult
}

/** @riviere-role cli-entrypoint */
export function createPiSessionInitializer<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
  TTransitionContext extends TransitionContext<TState, TStateName>,
>(
  deps: PiSessionInitializerDeps<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>,
): (event: SessionStartEvent, ctx: ExtensionContext, pi: ExtensionAPI, sessionId: string) => string | undefined {
  return function initializeSession(event, ctx, pi, sessionId) {
    try {
      const sessionFile = requireSessionFile(ctx)
      const header = ctx.sessionManager.getHeader()
      if (header?.id !== sessionId) return 'Pi session header does not match the active session UUID.'
      const activeBranchHasWorkflowMarker = hasPiWorkflowMarker(ctx.sessionManager.getBranch())
      const sessionHasWorkflowMarker = hasPiWorkflowMarker(ctx.sessionManager.getEntries())
      const inheritedWorkflowState = deps.ownership.usesInheritedWorkflow(sessionId)
      const delegatedParent = deps.ownership.delegatedParent(sessionId)
      const result = deps.useEngine(ctx, (engine) => {
        const sqliteHasWorkflowState = engine.hasSessionStarted(sessionId)
        if (!sqliteHasWorkflowState) {
          const parentFailure = deps.ownership.parentSafetyFailure(event, ctx)
          if (parentFailure !== undefined) return {
            type: 'error' as const,
            output: parentFailure,
          }
        }
        if (delegatedParent !== undefined && !sqliteHasWorkflowState) return {
          type: 'error' as const,
          output: `Pi parent session ${delegatedParent} has no persisted workflow.`,
        }
        if (!inheritedWorkflowState && sessionHasWorkflowMarker && !activeBranchHasWorkflowMarker) return {
          type: 'error' as const,
          output: `The active Pi branch does not contain this session's ${PI_WORKFLOW_MARKER_CUSTOM_TYPE} marker.`,
        }
        if (!inheritedWorkflowState && activeBranchHasWorkflowMarker !== sqliteHasWorkflowState) return {
          type: 'error' as const,
          output: `Pi transcript and SQLite workflow state disagree for session ${sessionId}.`,
        }
        const repository = getRepositoryName(ctx.cwd)
        if (repository === undefined) return {
          type: 'error' as const,
          output: 'repository must be a non-empty string.',
        }
        return engine.startSession(sessionId, sessionFile, repository)
      })
      if (result.type !== 'success') return result.output
      if (result.output !== '') {
        pi.sendMessage({
          customType: 'deterministic-agent-workflow',
          content: result.output,
          display: true,
        }, { triggerTurn: false })
      }
      return undefined
    } catch (error: unknown) {
      return String(error)
    }
  }
}
