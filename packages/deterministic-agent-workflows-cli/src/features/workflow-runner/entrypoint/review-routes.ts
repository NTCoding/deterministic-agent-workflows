import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  StoredEvent,
  WorkflowDefinition,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  flattenStoredEvent,
  reviewPayloadSchema,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  EXIT_ALLOW,
  EXIT_BLOCK,
  EXIT_ERROR,
} from '../../../shell/exit-codes'
import type { RunnerResult } from '../../../platform/domain/workflow-runner-types'

type FlagParseResult =
  | {
    readonly ok: true
    readonly flags: ReadonlyMap<string, string>
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

function parseFlagArgs(args: readonly string[]): FlagParseResult {
  const flags = new Map<string, string>()
  for (const [index, key] of args.entries()) {
    if (index % 2 === 1) continue
    const value = args[index + 1]
    if (!key.startsWith('--')) {
      return {
        ok: false,
        message: `Invalid flag: ${String(key)}`,
      }
    }
    if (typeof value !== 'string' || value.length === 0) {
      return {
        ok: false,
        message: `Missing value for flag: ${key}`,
      }
    }
    flags.set(key, value)
  }
  return {
    ok: true,
    flags,
  }
}

function validateReviewFlags(flags: ReadonlyMap<string, string>): string | null {
  for (const key of flags.keys()) {
    if (key !== '--type') {
      return `Unknown flag: ${key}`
    }
  }
  if (!flags.has('--type')) {
    return 'record-review requires --type'
  }
  return null
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
>(engine: { readonly hasSessionStarted: (sessionId: string) => boolean }, engineDeps: WorkflowEngineDeps, workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], readStdin: (() => string) | undefined, getSessionId: (() => string) | undefined): RunnerResult {
  if (getSessionId === undefined) {
    return errorResult('record-review requires an active workflow session')
  }
  if (readStdin === undefined) {
    return errorResult('record-review requires JSON on stdin')
  }

  const parsedFlags = parseFlagArgs(args.slice(1))
  if (!parsedFlags.ok) {
    return errorResult(parsedFlags.message)
  }
  const flagError = validateReviewFlags(parsedFlags.flags)
  if (flagError !== null) {
    return errorResult(flagError)
  }

  const reviewType = parsedFlags.flags.get('--type')
  if (reviewType === undefined) {
    return errorResult('record-review requires a non-empty --type value')
  }

  const sessionId = getSessionId()
  if (!engine.hasSessionStarted(sessionId)) {
    return errorResult(`Session ${sessionId} has not been started`)
  }

  const reviewPayloadResult = parseReviewPayload(readStdin)
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
    reviewType,
    sourceState: currentStateName,
    ...parsedReview.data,
  }, currentStateName)

  return jsonResult({
    ok: true,
    id: stored.id,
    sessionId,
    createdAt: stored.createdAt,
    reviewType,
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
  const state = storedEvents
    .map(flattenStoredEvent)
    .reduce((currentState, event) => workflowDefinition.fold(currentState, event), workflowDefinition.initialState())
  return state.currentStateMachineState
}

function parseReviewPayload(readStdin: () => string):
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
      payload: JSON.parse(readStdin()),
    }
  } catch (error) {
    return {
      ok: false,
      message: `Invalid review JSON: ${String(error)}`,
    }
  }
}
