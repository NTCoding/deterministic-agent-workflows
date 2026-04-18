import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  recordReflectionInputSchema,
  WorkflowEngine,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  EXIT_ALLOW,
  EXIT_ERROR,
} from '../../../shell/exit-codes'
import type {
  RunnerResult,
  WorkflowRunnerConfig,
} from '../../../platform/domain/workflow-runner-types'
import {
  buildReflectionProcess,
  resolveRepository,
} from '../domain/reflection-process'

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

function validateReflectionFlags(flags: ReadonlyMap<string, string>): string | null {
  for (const key of flags.keys()) {
    if (key !== '--label' && key !== '--agent-name' && key !== '--source-state') {
      return `Unknown flag: ${key}`
    }
  }
  return null
}

/** @riviere-role cli-entrypoint */
export function handleGetReflectionProcessRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, engineDeps: WorkflowEngineDeps, config: WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], getSessionId?: () => string, getSessionTranscriptPath?: () => string, getSessionRepository?: () => string | undefined, getRepositoryRoot?: () => string, getWorkflowEventsDbPath?: () => string): RunnerResult {
  if (args.length > 1) {
    return errorResult('get-reflection-process does not accept arguments')
  }
  if (getSessionId === undefined) {
    return errorResult('get-reflection-process requires an active workflow session')
  }
  const sessionId = getSessionId()
  if (!engine.hasSessionStarted(sessionId)) {
    return errorResult(`Session ${sessionId} has not been started`)
  }
  const events = engineDeps.store.readEvents(sessionId)
  return jsonResult(buildReflectionProcess({
    sessionId,
    repository: getSessionRepository?.() ?? resolveRepository(events),
    repositoryRoot: getRepositoryRoot?.(),
    transcriptPath: getSessionTranscriptPath?.(),
    eventStorePath: getWorkflowEventsDbPath?.(),
    workflowDefinition: config.workflowDefinition,
    events,
  }))
}

/** @riviere-role cli-entrypoint */
export function handleRecordReflectionRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, engineDeps: WorkflowEngineDeps, args: readonly string[], readStdin: (() => string) | undefined, getSessionId?: () => string): RunnerResult {
  if (getSessionId === undefined) {
    return errorResult('record-reflection requires an active workflow session')
  }
  if (readStdin === undefined) {
    return errorResult('record-reflection requires JSON on stdin')
  }
  const parsedFlags = parseFlagArgs(args.slice(1))
  if (!parsedFlags.ok) {
    return errorResult(parsedFlags.message)
  }
  const flagError = validateReflectionFlags(parsedFlags.flags)
  if (flagError !== null) {
    return errorResult(flagError)
  }
  const sessionId = getSessionId()
  if (!engine.hasSessionStarted(sessionId)) {
    return errorResult(`Session ${sessionId} has not been started`)
  }

  try {
    const reflectionPayload: unknown = JSON.parse(readStdin())
    const parsed = recordReflectionInputSchema.safeParse({
      label: parsedFlags.flags.get('--label'),
      agentName: parsedFlags.flags.get('--agent-name'),
      sourceState: parsedFlags.flags.get('--source-state'),
      reflection: reflectionPayload,
    })
    if (!parsed.success) {
      return errorResult(`Invalid reflection payload: ${parsed.error.message}`)
    }

    const stored = engineDeps.store.recordReflection(sessionId, engineDeps.now(), parsed.data)
    return jsonResult({
      ok: true,
      id: stored.id,
      sessionId: stored.sessionId,
      createdAt: stored.createdAt,
    })
  } catch (error) {
    return errorResult(`Invalid reflection JSON: ${String(error)}`)
  }
}
