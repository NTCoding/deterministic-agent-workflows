import type { EngineResult } from '@nt-ai-lab/deterministic-agent-workflow-engine'

/** @riviere-role value-object */
export interface FreshContextLaunch {
  readonly workflowSessionId: string
  readonly stateInstructions: string
}

/** @riviere-role value-object */
export interface FreshContextLauncher { readonly start: (launch: FreshContextLaunch) => Promise<void> }

type RetirementRecord = {
  readonly hostSessionId: string
  readonly at: string
}

type RetirementAwareEngine = {
  readonly retireContext: (sessionId: string, reason: string) => EngineResult
  readonly getContextRetirement: (sessionId: string) => RetirementRecord | undefined
}

/** @riviere-role value-object */
export interface EnterReviewingInput { readonly stateInstructions: string }

/** @riviere-role value-object */
export interface WorkflowContextBoundaryDeps {
  readonly engine: RetirementAwareEngine
  readonly sessionId: string
  readonly retirementReason?: string
  readonly launcher?: FreshContextLauncher
}

/** @riviere-role value-object */
export interface RetiredAndLaunchedResult { readonly type: 'retired-and-launched' }

/** @riviere-role value-object */
export interface RetiredResult {
  readonly type: 'retired'
  readonly reason: string
}

/** @riviere-role value-object */
export interface BlockedResult {
  readonly type: 'blocked'
  readonly output: string
}

/** @riviere-role value-object */
export type WorkflowContextBoundaryResult = RetiredAndLaunchedResult | RetiredResult | BlockedResult

/** @riviere-role domain-service */
export function createWorkflowContextBoundary(
  deps: WorkflowContextBoundaryDeps,
): { readonly enterReviewing: (input: EnterReviewingInput) => Promise<WorkflowContextBoundaryResult> } {
  const retirementReason = deps.retirementReason ?? 'Reviewing now owns the work.'
  return {
    async enterReviewing(input): Promise<WorkflowContextBoundaryResult> {
      const existing = deps.engine.getContextRetirement(deps.sessionId)
      if (existing?.hostSessionId === deps.sessionId) {
        return {
          type: 'retired',
          reason: 'This context is already retired.',
        }
      }
      const retired = deps.engine.retireContext(deps.sessionId, retirementReason)
      if (retired.type === 'blocked' || retired.type === 'error') {
        return {
          type: 'blocked',
          output: retired.output,
        }
      }
      if (deps.launcher === undefined) {
        return {
          type: 'retired',
          reason: retirementReason,
        }
      }
      await deps.launcher.start({
        workflowSessionId: deps.sessionId,
        stateInstructions: input.stateInstructions,
      })
      return { type: 'retired-and-launched' }
    },
  }
}
