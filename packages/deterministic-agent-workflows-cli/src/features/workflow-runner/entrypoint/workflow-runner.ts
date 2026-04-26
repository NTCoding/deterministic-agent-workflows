import type {
  BaseWorkflowState,
  EngineResult,
  RehydratableWorkflow,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { WorkflowEngine } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  EXIT_ALLOW, EXIT_BLOCK, EXIT_ERROR 
} from '../../../shell/exit-codes'
import type { ArgParser } from '../../../platform/domain/argument-parser-types'
import {
  formatContextInjection, formatDenyDecision 
} from '../../../platform/infra/cli/presentation/hook-output'
import {
  hookCommonInputSchema,
  preToolUseInputSchema,
  subagentStartInputSchema,
  teammateIdleInputSchema,
  type PreToolUseInput,
  type SubagentStartInput,
  type TeammateIdleInput,
} from '../../../platform/infra/external-clients/claude-hooks/hook-schemas'
import type { PreToolUseHandlerFn } from '../../../platform/domain/pre-tool-use-handler'
import { createPreToolUseHandler } from '../../../platform/domain/pre-tool-use-handler'
import { getRepositoryName } from '../../../platform/infra/external-clients/git/repository-name'
import type {
  RunnerOptions,
  RunnerResult,
  WorkflowRunnerConfig,
} from '../../../platform/domain/workflow-runner-types'
import {
  handleGetReflectionProcessRoute,
  handleRecordReflectionRoute,
} from './reflection-routes'
import { handleRecordReviewRoute } from './review-routes'

export type { PreToolUseHandlerFn } from '../../../platform/domain/pre-tool-use-handler'

function resolvePreToolUseHandler<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(config: WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation>): PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation> | undefined {
  const hasPolicy = config.bashForbidden !== undefined || config.isWriteAllowed !== undefined || config.customGates !== undefined
  if (config.preToolUseHandler !== undefined) {
    if (hasPolicy) {
      throw new TypeError('WorkflowRunnerConfig: preToolUseHandler is mutually exclusive with bashForbidden/isWriteAllowed/customGates. Provide either policy fields (default path) or a custom handler (escape hatch), not both.')
    }
    return config.preToolUseHandler
  }
  if (config.bashForbidden === undefined && config.isWriteAllowed === undefined) {
    if (config.customGates !== undefined) {
      throw new TypeError('WorkflowRunnerConfig: customGates requires bashForbidden and isWriteAllowed to also be set.')
    }
    return undefined
  }
  if (config.bashForbidden === undefined || config.isWriteAllowed === undefined) {
    throw new TypeError('WorkflowRunnerConfig: bashForbidden and isWriteAllowed must be provided together.')
  }
  if (config.customGates === undefined) {
    return createPreToolUseHandler<TWorkflow, TState, TDeps, TStateName, TOperation>({
      bashForbidden: config.bashForbidden,
      isWriteAllowed: config.isWriteAllowed 
    })
  }
  return createPreToolUseHandler<TWorkflow, TState, TDeps, TStateName, TOperation>({
    bashForbidden: config.bashForbidden,
    isWriteAllowed: config.isWriteAllowed,
    customGates: config.customGates,
  })
}

function engineResultToRunnerResult(result: EngineResult): RunnerResult {
  switch (result.type) {
    case 'success': return {
      output: result.output,
      exitCode: EXIT_ALLOW 
    }
    case 'blocked': return {
      output: result.output,
      exitCode: EXIT_BLOCK 
    }
    case 'error': return {
      output: result.output,
      exitCode: EXIT_ERROR 
    }
  }
}

function parseArgs(argParsers: readonly ArgParser<unknown>[] | undefined, args: readonly string[], routeName: string): {
  readonly ok: true;
  readonly values: readonly unknown[] 
} | {
  readonly ok: false;
  readonly message: string 
} {
  const values: unknown[] = []
  for (const [index, parser] of (argParsers ?? []).entries()) {
    const result = parser.parse(args, index + 1, routeName)
    if (!result.ok) return {
      ok: false,
      message: result.message 
    }
    values.push(result.value)
  }
  return {
    ok: true,
    values 
  }
}

function assertSessionId(values: readonly unknown[]): string {
  const id = values[0]
  if (typeof id !== 'string') throw new TypeError('session-id argument must be a string')
  return id
}

function assertTarget(values: readonly unknown[]): string {
  const target = values[1]
  if (typeof target !== 'string') throw new TypeError('target argument must be a string')
  return target
}

/** @riviere-role cli-entrypoint */
export function createWorkflowRunner<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
>(config: WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation>): (args: readonly string[], engineDeps: WorkflowEngineDeps, workflowDeps: TDeps, options?: RunnerOptions) => RunnerResult {
  const resolvedHandler = resolvePreToolUseHandler(config)
  return (args, engineDeps, workflowDeps, options) => {
    const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)
    if (args.length > 0) {
      return handleRoute(
        engine,
        engineDeps,
        config,
        args,
        args[0],
        options?.readStdin,
        options?.getSessionId,
        options?.getSessionTranscriptPath,
        options?.getSessionRepository,
        options?.getRepositoryRoot,
        options?.getWorkflowEventsDbPath,
      )
    }
    if (options?.readStdin === undefined) return {
      output: 'No command and no stdin available',
      exitCode: EXIT_ERROR 
    }
    return handleHook(engine, resolvedHandler, options.readStdin)
  }
}

function handleWriteJournalRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], getSessionId?: () => string): RunnerResult {
  const hasExplicitSessionId = getSessionId === undefined
  const sessionId = hasExplicitSessionId ? args[1] : getSessionId()
  const agentNameIndex = hasExplicitSessionId ? 2 : 1
  const contentIndex = hasExplicitSessionId ? 3 : 2
  const agentName = args[agentNameIndex]
  const content = args.slice(contentIndex).join(' ').trim()
  if (typeof sessionId !== 'string' || typeof agentName !== 'string' || content.length === 0) {
    return {
      output: 'write-journal requires <agent-name> and <content> arguments',
      exitCode: EXIT_ERROR,
    }
  }
  return engineResultToRunnerResult(engine.writeJournal(sessionId, agentName, content))
}

function handleGetStateRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], getSessionId?: () => string): RunnerResult {
  const sessionId = getSessionId === undefined ? args[1] : getSessionId()
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return {
      output: 'get-state requires <session-id> argument',
      exitCode: EXIT_ERROR,
    }
  }
  return engineResultToRunnerResult(engine.getState(sessionId))
}

function handleRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, engineDeps: WorkflowEngineDeps, config: WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], routeName: string, readStdin?: () => string, getSessionId?: () => string, getSessionTranscriptPath?: () => string, getSessionRepository?: () => string | undefined, getRepositoryRoot?: () => string, getWorkflowEventsDbPath?: () => string): RunnerResult {
  const builtin = resolveBuiltinRoute(
    engine,
    engineDeps,
    config,
    args,
    routeName,
    readStdin,
    getSessionId,
    getSessionTranscriptPath,
    getSessionRepository,
    getRepositoryRoot,
    getWorkflowEventsDbPath,
  )
  if (builtin !== undefined) return builtin
  const routeDef = Object.hasOwn(config.routes, routeName) ? config.routes[routeName] : undefined
  if (routeDef === undefined) return {
    output: `Unknown command: ${routeName}`,
    exitCode: EXIT_ERROR
  }

  const parsedArgs = parseArgs(routeDef.args, args, routeName)
  if (!parsedArgs.ok) return {
    output: parsedArgs.message,
    exitCode: EXIT_ERROR 
  }

  const resolveSessionId = (): string => getSessionId === undefined ? assertSessionId(parsedArgs.values) : getSessionId()
  const argsAfterSessionId = (): readonly unknown[] => getSessionId === undefined ? parsedArgs.values.slice(1) : parsedArgs.values
  const resolveTarget = (): string => {
    if (getSessionId === undefined) return assertTarget(parsedArgs.values)
    const target = parsedArgs.values[0]
    if (typeof target !== 'string') throw new TypeError('target argument must be a string')
    return target
  }

  switch (routeDef.type) {
    case 'session-start': {
      const transcriptPath = getSessionTranscriptPath === undefined ? '' : getSessionTranscriptPath()
      return engineResultToRunnerResult(engine.startSession(resolveSessionId(), transcriptPath, getSessionRepository?.()))
    }
    case 'transition':
      return engineResultToRunnerResult(engine.transition(resolveSessionId(), config.workflowDefinition.stateSchema.parse(resolveTarget())))
    case 'transaction':
      return engineResultToRunnerResult(engine.transaction(resolveSessionId(), routeName, (workflow) => routeDef.handler(workflow, ...argsAfterSessionId())))
  }
}

function resolveBuiltinRoute<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, engineDeps: WorkflowEngineDeps, config: WorkflowRunnerConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, args: readonly string[], routeName: string, readStdin?: () => string, getSessionId?: () => string, getSessionTranscriptPath?: () => string, getSessionRepository?: () => string | undefined, getRepositoryRoot?: () => string, getWorkflowEventsDbPath?: () => string): RunnerResult | undefined {
  switch (routeName) {
    case 'get-state':
      return handleGetStateRoute(engine, args, getSessionId)
    case 'get-reflection-process':
      return handleGetReflectionProcessRoute(engine, engineDeps, config, args, getSessionId, getSessionTranscriptPath, getSessionRepository, getRepositoryRoot, getWorkflowEventsDbPath)
    case 'record-reflection':
      return handleRecordReflectionRoute(engine, engineDeps, args, readStdin, getSessionId)
    case 'record-review':
      return handleRecordReviewRoute(engine, engineDeps, config.workflowDefinition, args, readStdin, getSessionId)
    case 'write-journal':
      return handleWriteJournalRoute(engine, args, getSessionId)
    default:
      return undefined
  }
}

function handleHook<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, resolvedHandler: PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation> | undefined, readStdin: () => string): RunnerResult {
  const stdin = readStdin()
  const hookInput: unknown = JSON.parse(stdin)
  const commonParse = hookCommonInputSchema.safeParse(hookInput)
  if (!commonParse.success) return {
    output: `Invalid hook input: ${commonParse.error.message}`,
    exitCode: EXIT_ERROR 
  }

  const common = commonParse.data
  if (common.hook_event_name === 'SessionStart') {
    engine.persistSessionId(common.session_id)
    if (!engine.hasSessionStarted(common.session_id)) {
      return {
        output: '',
        exitCode: EXIT_ALLOW
      }
    }
    return engineResultToRunnerResult(engine.startSession(common.session_id, common.transcript_path, getRepositoryName(common.cwd)))
  }
  if (!engine.hasSession(common.session_id)) return {
    output: '',
    exitCode: EXIT_ALLOW 
  }

  switch (common.hook_event_name) {
    case 'PreToolUse': return handlePreToolUseHook(engine, resolvedHandler, stdin)
    case 'SubagentStart': return handleSubagentStartHook(engine, stdin)
    case 'TeammateIdle': return handleTeammateIdleHook(engine, stdin)
    default: return {
      output: '',
      exitCode: EXIT_ALLOW 
    }
  }
}

function handlePreToolUseHook<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, resolvedHandler: PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation> | undefined, stdin: string): RunnerResult {
  const hookInput: unknown = JSON.parse(stdin)
  const toolParse = preToolUseInputSchema.safeParse(hookInput)
  if (!toolParse.success) return {
    output: `Invalid pre-tool-use input: ${toolParse.error.message}`,
    exitCode: EXIT_ERROR 
  }
  return handlePreToolUse(engine, resolvedHandler, toolParse.data)
}

function handlePreToolUse<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, resolvedHandler: PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation> | undefined, input: PreToolUseInput): RunnerResult {
  if (resolvedHandler === undefined) return {
    output: '',
    exitCode: EXIT_ALLOW 
  }
  const result = resolvedHandler(engine, input.session_id, input.tool_name, input.tool_input)
  if (result.type === 'blocked') return {
    output: formatDenyDecision(result.output),
    exitCode: EXIT_BLOCK 
  }
  return engineResultToRunnerResult(result)
}

function handleSubagentStartHook<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, stdin: string): RunnerResult {
  const hookInput: unknown = JSON.parse(stdin)
  const parsed = subagentStartInputSchema.safeParse(hookInput)
  if (!parsed.success) return {
    output: `Invalid subagent-start input: ${parsed.error.message}`,
    exitCode: EXIT_ERROR 
  }

  const input: SubagentStartInput = parsed.data
  const result = engine.transaction(input.session_id, 'register-agent', (workflow) => workflow.registerAgent(input.agent_type, input.agent_id))
  return {
    output: formatContextInjection(result.type === 'success' ? result.output : ''),
    exitCode: EXIT_ALLOW 
  }
}

function handleTeammateIdleHook<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, stdin: string): RunnerResult {
  const hookInput: unknown = JSON.parse(stdin)
  const parsed = teammateIdleInputSchema.safeParse(hookInput)
  if (!parsed.success) return {
    output: `Invalid teammate-idle input: ${parsed.error.message}`,
    exitCode: EXIT_ERROR 
  }

  const input: TeammateIdleInput = parsed.data
  const agentName = resolveTeammateName(input.teammate_name)
  return engineResultToRunnerResult(engine.transaction(input.session_id, 'check-idle', (workflow) => workflow.handleTeammateIdle(agentName)))
}

function resolveTeammateName(teammateName: string | undefined): string {
  if (teammateName === undefined) {
    return ''
  }
  return teammateName
}
