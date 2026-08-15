import type { BaseWorkflowState } from './workflow-state'
import type {
  EngineResult,
  ReviewCycleDefinition,
  WorkflowEngineDeps,
} from './workflow-engine-types'
import {
  getSessionRepository,
  sameReviewTypes,
} from './workflow-review-cycle-support'

/** @riviere-role domain-service */
export function runWorkflowReviewCycle<
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
>(input: {
  readonly sessionId: string
  readonly reviewCycle: ReviewCycleDefinition<TState, TDeps, TStateName>
  readonly engineDeps: WorkflowEngineDeps
  readonly workflowDeps: TDeps
  readonly getState: () => TState
  readonly persistPlatformEvent: (state: TState, event: unknown) => void
  readonly transition: (target: TStateName) => EngineResult
}): EngineResult {
  const request = input.reviewCycle.buildRequest(input.getState(), input.workflowDeps)
  const requiredReviewTypes = [...new Set(request.requiredReviewTypes)]
  if (requiredReviewTypes.length === 0 || requiredReviewTypes.length !== request.requiredReviewTypes.length) {
    return failReviewCycle(input, request.reviewedCommit, [], 'Review cycle must define each required reviewer exactly once.')
  }
  input.persistPlatformEvent(input.getState(), {
    type: 'review-cycle-started',
    at: input.engineDeps.now(),
    reviewedCommit: request.reviewedCommit,
    requiredReviewTypes,
  })
  if (input.engineDeps.reviewBundleRunner === undefined) {
    return failReviewCycle(input, request.reviewedCommit, [], 'No workflow review-bundle runner is configured.')
  }
  try {
    const result = input.engineDeps.reviewBundleRunner.run({
      sessionId: input.sessionId,
      repository: getSessionRepository(input.engineDeps.store, input.sessionId),
      reviewedCommit: request.reviewedCommit,
      requiredReviewTypes,
    })
    const actualReviewTypes = result.reviews.map((review) => review.reviewType)
    if (!sameReviewTypes(requiredReviewTypes, actualReviewTypes)) {
      return failReviewCycle(input, request.reviewedCommit, [], 'Review bundle did not return exactly the required reviewer results.')
    }
    const reviews = result.reviews.map((review) => input.engineDeps.store.recordReviewWithEvent(
      input.sessionId,
      input.engineDeps.now(),
      {
        reviewType: review.reviewType,
        ...review.payload,
        sourceState: String(input.reviewCycle.reviewingState),
      },
      String(input.reviewCycle.reviewingState),
    ))
    const outcome = reviews.some((review) => review.verdict === 'FAIL') ? 'FAIL' : 'PASS'
    input.persistPlatformEvent(input.getState(), {
      type: 'review-cycle-completed',
      at: input.engineDeps.now(),
      reviewedCommit: request.reviewedCommit,
      outcome,
      reviewIds: reviews.map((review) => review.id),
    })
    return input.transition(outcome === 'PASS' ? input.reviewCycle.passedState : input.reviewCycle.reworkState)
  } catch (error: unknown) {
    return failReviewCycle(input, request.reviewedCommit, [], String(error))
  }
}

function failReviewCycle<
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
>(input: Parameters<typeof runWorkflowReviewCycle<TState, TDeps, TStateName>>[0], reviewedCommit: string, reviewIds: readonly number[], error: string): EngineResult {
  input.persistPlatformEvent(input.getState(), {
    type: 'review-cycle-completed',
    at: input.engineDeps.now(),
    reviewedCommit,
    outcome: 'ERROR',
    reviewIds,
    error,
  })
  const transitionResult = input.transition(input.reviewCycle.blockedState)
  if (transitionResult.type !== 'success') return transitionResult
  return {
    type: 'error',
    output: `Review cycle failed and the workflow moved to ${String(input.reviewCycle.blockedState)}: ${error}`,
  }
}
