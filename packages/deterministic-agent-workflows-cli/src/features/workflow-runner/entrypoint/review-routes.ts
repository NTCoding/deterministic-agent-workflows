import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  StoredEvent,
  WorkflowDefinition,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  reduceWorkflowStateFromStoredEvents,
  reviewPayloadSchema,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  EXIT_ALLOW,
  EXIT_BLOCK,
  EXIT_ERROR,
} from '../../../shell/exit-codes'
import type { RunnerResult } from '../../../platform/domain/workflow-runner-types'

type ReviewArgumentParseResult =
  | {
    readonly ok: true
    readonly reviewType: string
    readonly reviewJson: string
  }
  | {
    readonly ok: false
    readonly message: string
  }

function jsonResult(value: unknown): RunnerResult {
  return {
    output: JSON.stringify(value, null, 2),
    exitCode: EXIT_ALLOW,
  }
}

function errorResult(output: string): RunnerResult {
  return {
    output,
    exitCode: EXIT_ERROR,
  }
}

function blockedResult(output: string): RunnerResult {
  return {
    output,
    exitCode: EXIT_BLOCK,
  }
}

function parseReviewArguments(args: readonly string[]): ReviewArgumentParseResult {
  const reviewType = args[1]
  const reviewJson = args[2]
  if (args.length !== 3 || typeof reviewType !== 'string' || typeof reviewJson !== 'string') {
    return {
      ok: false,
      message: 'record-review requires <review-type> and <review-json> arguments',
    }
  }
  if (reviewType.length === 0) {
    return {
      ok: false,
      message: 'record-review requires a non-empty review type',
    }
  }
  return {
    ok: true,
    reviewType,
    reviewJson,
  }
}

function isReviewAllowed(
  allowedWorkflowOperations: ReadonlyArray<string>,
): boolean {
  return allowedWorkflowOperations.some((allowedWorkflowOperation) => allowedWorkflowOperation === 'record-review')
}

/** @riviere-role cli-entrypoint */
export function handleRecordReviewRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: { readonly hasSessionStarted: (sessionId: string) => boolean }, engineDeps: WorkflowEngineDeps, workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], getSessionId: (() => string) | undefined): RunnerResult {
  if (getSessionId === undefined) {
    return errorResult('record-review requires an active workflow session')
  }

  const parsedArguments = parseReviewArguments(args)
  if (!parsedArguments.ok) {
    return errorResult(parsedArguments.message)
  }

  const sessionId = getSessionId()
  if (!engine.hasSessionStarted(sessionId)) {
    return errorResult(`Session ${sessionId} has not been started`)
  }

  const reviewPayloadResult = parseReviewPayload(parsedArguments.reviewJson)
  if (!reviewPayloadResult.ok) {
    return errorResult(reviewPayloadResult.message)
  }

  const parsedReview = reviewPayloadSchema.safeParse(reviewPayloadResult.payload)
  if (!parsedReview.success) {
    return errorResult(`Invalid review payload: ${parsedReview.error.message}`)
  }

  const currentStateName = computeCurrentState(workflowDefinition, engineDeps.store.readEvents(sessionId))
  const allowedWorkflowOperations = workflowDefinition
    .getRegistry()[currentStateName]
    .allowedWorkflowOperations
    .map((allowedWorkflowOperation) => String(allowedWorkflowOperation))
  if (!isReviewAllowed(allowedWorkflowOperations)) {
    return blockedResult(`record-review is not allowed in state ${currentStateName}.`)
  }

  const createdAt = engineDeps.now()
  const stored = engineDeps.store.recordReviewWithEvent(sessionId, createdAt, {
    reviewType: parsedArguments.reviewType,
    sourceState: currentStateName,
    ...parsedReview.data,
  }, currentStateName)

  return jsonResult({
    ok: true,
    id: stored.id,
    sessionId,
    createdAt: stored.createdAt,
    reviewType: parsedArguments.reviewType,
    verdict: parsedReview.data.verdict,
  })
}

function computeCurrentState<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>, storedEvents: readonly StoredEvent[]): TStateName {
  const state = reduceWorkflowStateFromStoredEvents(workflowDefinition, storedEvents)
  return state.currentStateMachineState
}

function parseReviewPayload(reviewJson: string):
  | {
    readonly ok: true
    readonly payload: unknown
  }
  | {
    readonly ok: false
    readonly message: string
  } {
  try {
    return {
      ok: true,
      payload: JSON.parse(reviewJson),
    }
  } catch (error) {
    return {
      ok: false,
      message: `Invalid review JSON: ${String(error)}`,
    }
  }
}
