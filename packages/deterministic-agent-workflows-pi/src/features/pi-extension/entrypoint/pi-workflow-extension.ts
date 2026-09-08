import { join } from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import type {
  BaseWorkflowState,
  EngineResult,
  RehydratableWorkflow,
  TransitionContext,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { WorkflowEngine } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  createPreToolUseHandler,
  createWorkflowRunner,
  formatStopPreventionMessage,
  getRepositoryName,
  type PlatformContext,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { Type } from 'typebox'
import type {
  PiInitializationStatus,
  PiWorkflowExtension,
  PiWorkflowExtensionConfig,
} from '../../../platform/domain/pi-workflow-extension-types'
import { parsePiCommandArguments } from '../../../platform/domain/pi-command-arguments'
import { hasPiWorkflowMarker } from '../../../platform/infra/external-clients/pi/pi-session-file'
import {
  getLatestPiAssistantSettlement,
  type PiAssistantSettlement,
  PiTranscriptReader,
} from '../../../platform/infra/external-clients/pi/pi-transcript-reader'
import {
  notifyRouteResult,
  readSessionId,
  readWorkflowInstruction,
  requireSessionFile,
  resolveDatabasePath,
  translationNote,
} from './pi-workflow-extension-platform'
import { createPiWorkflowSessionOwnership } from './pi-workflow-session-ownership'
import { createPiSessionInitializer } from './pi-workflow-initialization'
import { registerPiWorkflowAutomation } from './pi-workflow-automation'
const PI_QUESTION_TOOL = 'question'; const DEFAULT_COMMAND_NAME = 'workflow'; const DEFAULT_TOOL_NAME = 'workflow'
const INITIALIZATION_PENDING_REASON = 'Pi workflow initialization has not completed safely. Tool execution is blocked.'; const INACTIVE_WORKFLOW_REASON = 'Pi workflow is inactive. Run the workflow init command before using workflow operations.'
export const PI_IDLE_RECOVERY_MESSAGE = formatStopPreventionMessage()
export const PI_SESSION_BRANCH_BLOCK_MESSAGE = 'Pi session tree navigation and forks are disabled while a workflow is active.'

const workflowToolParameters = Type.Object({
  operation: Type.String({ description: 'Workflow operation, for example init or transition' }),
  args: Type.Optional(Type.Array(Type.String({ description: 'One workflow operation argument' }))),
})

/** @riviere-role cli-entrypoint */
export function createPiWorkflowExtension<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string, TTransitionContext extends TransitionContext<TState, TStateName> = TransitionContext<TState, TStateName>,
>(
  config: PiWorkflowExtensionConfig<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>,
): PiWorkflowExtension {
  const databasePath = resolveDatabasePath(config.databasePath)
  const commandName = config.commandName ?? DEFAULT_COMMAND_NAME
  const toolName = config.toolName ?? DEFAULT_TOOL_NAME
  const ownership = createPiWorkflowSessionOwnership(databasePath)
  const initializationBySession = new Map<string, PiInitializationStatus>()
  const sessionStartsById = new Map<string, SessionStartEvent>()
  const recoveredAssistantBySession = new Map<string, string>()
  const preToolUse = createPreToolUseHandler<TWorkflow, TState, TDeps, TStateName, TOperation>({
    bashForbidden: config.bashForbidden,
    isWriteAllowed: config.isWriteAllowed,
    questionToolName: PI_QUESTION_TOOL,
    customGates: config.customGates,
  })
  const runner = createWorkflowRunner<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>({
    workflowDefinition: config.workflowDefinition,
    routes: config.routes,
    unknownCommandMessage: config.unknownCommandMessage,
    bashForbidden: config.bashForbidden,
    isWriteAllowed: config.isWriteAllowed,
    questionToolName: PI_QUESTION_TOOL,
    customGates: config.customGates,
  })

  function buildEngineDeps(ctx: ExtensionContext, store: ReturnType<typeof createStore>): WorkflowEngineDeps {
    const sessionId = ctx.sessionManager.getSessionId()
    const now = () => new Date().toISOString()
    const note = translationNote(toolName)
    return {
      store,
      getPluginRoot: () => config.pluginRoot,
      getEnvFilePath: () => join(config.pluginRoot, '.pi', 'unused.env'),
      getRepositoryName: () => getRepositoryName(ctx.cwd),
      readFile: (path) => readWorkflowInstruction(path, note),
      appendToFile: () => undefined,
      now,
      transcriptReader: new PiTranscriptReader(() => ctx.sessionManager.getBranch()),
      sessionContext: {getMainSessionId: () => ownership.resolveWorkflowSessionId(sessionId, store),},
    }
  }

  function useEngine<TResult>(
    ctx: ExtensionContext,
    operation: (
      engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>,
      engineDeps: WorkflowEngineDeps,
      workflowDeps: TDeps,
    ) => TResult,
  ): TResult {
    const store = createStore(databasePath)
    try {
      const engineDeps = buildEngineDeps(ctx, store)
      const now = engineDeps.now
      const sessionId = ctx.sessionManager.getSessionId()
      ownership.requireAccess(store, sessionId)
      const platform: PlatformContext = {
        getPluginRoot: () => config.pluginRoot,
        now,
        getSessionId: () => sessionId,
        workflowEventStore: store,
        reviewStore: store,
      }
      const workflowDeps = config.buildWorkflowDeps(platform)
      const engine = new WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>(config.workflowDefinition, engineDeps, workflowDeps)
      return operation(engine, engineDeps, workflowDeps)
    } finally {
      store.db.close()
    }
  }

  function markInitializationFailed(ctx: ExtensionContext, sessionId: string, detail: string): string {
    return failSession(ctx, sessionId, `Pi workflow initialization failed: ${detail}`)
  }

  function markSafetyUnavailable(ctx: ExtensionContext, sessionId: string, detail: string): string {
    return failSession(ctx, sessionId, `Pi workflow safety is unavailable: ${detail}`)
  }

  function failSession(ctx: ExtensionContext, sessionId: string, reason: string): string {
    initializationBySession.set(sessionId, {
      type: 'failed',
      reason,
    })
    ctx.ui.notify(reason, 'error')
    ctx.shutdown()
    return reason
  }

  function readinessFailure(ctx: ExtensionContext): string | undefined {
    const session = readSessionId(ctx)
    if (!session.ok) return session.reason
    const status = initializationBySession.get(session.sessionId)
    if (status?.type === 'ready') return undefined
    if (status?.type === 'inactive') return INACTIVE_WORKFLOW_REASON
    return status?.type === 'failed' ? status.reason : INITIALIZATION_PENDING_REASON
  }

  function isInactive(ctx: ExtensionContext): boolean {
    const session = readSessionId(ctx)
    if (!session.ok) return false
    return initializationBySession.get(session.sessionId)?.type === 'inactive'
  }

  function runRoute(ctx: ExtensionContext, args: readonly string[], pi: ExtensionAPI) {
    if (isInactive(ctx) && args[0] === 'init') {
      const session = readSessionId(ctx)
      if (!session.ok) return {
        output: session.reason,
        exitCode: 1,
      }
      const event = sessionStartsById.get(session.sessionId)
      if (event === undefined) return {
        output: INITIALIZATION_PENDING_REASON,
        exitCode: 1,
      }
      initializationBySession.set(session.sessionId, { type: 'initializing' })
      const failure = initializeSession(event, ctx, pi, session.sessionId)
      if (failure !== undefined) return {
        output: markInitializationFailed(ctx, session.sessionId, failure),
        exitCode: 1,
      }
      initializationBySession.set(session.sessionId, { type: 'ready' })
    }
    const notReady = readinessFailure(ctx)
    if (notReady !== undefined) return {
      output: notReady,
      exitCode: 1,
    }
    const session = readSessionId(ctx)
    if (!session.ok) return {
      output: session.reason,
      exitCode: 1,
    }
    try {
      return useEngine(ctx, (_engine, engineDeps, workflowDeps) => runner(args, engineDeps, workflowDeps, {
        getSessionId: () => session.sessionId,
        getSessionTranscriptPath: () => requireSessionFile(ctx),
        getSessionRepository: () => getRepositoryName(ctx.cwd),
        getRepositoryRoot: () => ctx.cwd,
        getWorkflowEventsDbPath: () => databasePath,
      }))
    } catch (error: unknown) {
      return {
        output: markSafetyUnavailable(ctx, session.sessionId, `Workflow operation could not establish safe state: ${String(error)}`),
        exitCode: 1,
      }
    }
  }

  function isContextRetiredFor(ctx: ExtensionContext, sessionId: string): boolean {
    try {
      return useEngine(ctx, (engine) => engine.getContextRetirement(sessionId))?.hostSessionId === sessionId
    } catch {
      return false
    }
  }

  const initializeSession = createPiSessionInitializer({
    ownership,
    useEngine,
  })

  return (pi: ExtensionAPI): void => {
    pi.on('session_start', (event, ctx) => {
      const session = readSessionId(ctx)
      if (!session.ok) {
        ctx.ui.notify(`Pi workflow initialization failed: ${session.reason}`, 'error')
        ctx.shutdown()
        return
      }
      sessionStartsById.set(session.sessionId, event)
      try {
        const hasPersistedWorkflow = ownership.hasPersistedWorkflow(session.sessionId)
        const hasTranscriptWorkflow = hasPiWorkflowMarker(ctx.sessionManager.getEntries())
        if (!hasPersistedWorkflow && !hasTranscriptWorkflow) {
          initializationBySession.set(session.sessionId, { type: 'inactive' })
          return
        }
      } catch (error: unknown) {
        markInitializationFailed(ctx, session.sessionId, String(error))
        return
      }
      initializationBySession.set(session.sessionId, { type: 'initializing' })
      const failure = initializeSession(event, ctx, pi, session.sessionId)
      if (failure !== undefined) {
        markInitializationFailed(ctx, session.sessionId, failure)
        return
      }
      initializationBySession.set(session.sessionId, { type: 'ready' })
    })

    pi.on('tool_call', (event, ctx) => {
      if (isInactive(ctx)) return
      const notReady = readinessFailure(ctx)
      if (notReady !== undefined) return {
        block: true,
        reason: notReady,
      }
      const session = readSessionId(ctx)
      if (!session.ok) return {
        block: true,
        reason: session.reason,
      }
      try {
        const result = useEngine(ctx, (engine): EngineResult => preToolUse(
          engine,
          session.sessionId,
          event.toolName,
          { ...event.input },
        ))
        if (result.type === 'success') return
        return {
          block: true,
          reason: result.output,
        }
      } catch (error: unknown) {
        return {
          block: true,
          reason: markSafetyUnavailable(ctx, session.sessionId, `Tool safety could not be established: ${String(error)}`),
        }
      }
    })

    pi.on('input', (_event, ctx) => {
      if (isInactive(ctx)) return
      const notReady = readinessFailure(ctx)
      if (notReady === undefined) return
      ctx.ui.notify(notReady, 'error')
      return { action: 'handled' }
    })

    const maybeRepromptAfterSettlement = (ctx: ExtensionContext, sessionId: string): void => {
      const settlement: PiAssistantSettlement | undefined = getLatestPiAssistantSettlement(ctx.sessionManager.getBranch())
      if (settlement?.stopReason !== 'stop') return
      if (recoveredAssistantBySession.get(sessionId) === settlement.id) return
      try {
        const result = useEngine(ctx, (engine) => engine.checkStopping(sessionId, 'stop'))
        if (result.type === 'blocked' && ctx.isIdle() && !ctx.hasPendingMessages()) {
          recoveredAssistantBySession.set(sessionId, settlement.id)
          pi.sendUserMessage(formatStopPreventionMessage(result.output, config.stopPreventionMessage))
        }
      } catch (error: unknown) {
        markSafetyUnavailable(ctx, sessionId, `Stopping safety could not be established: ${String(error)}`)
      }
    }

    pi.on('agent_settled', (_event, ctx) => {
      if (isInactive(ctx) || readinessFailure(ctx) !== undefined || automation.ownsState(ctx)) return
      const session = readSessionId(ctx)
      if (!session.ok || isContextRetiredFor(ctx, session.sessionId)) return
      maybeRepromptAfterSettlement(ctx, session.sessionId)
    })

    const blockSessionBranching = (ctx: ExtensionContext): { readonly cancel: true } | undefined => {
      const session = readSessionId(ctx)
      if (!session.ok) {
        ctx.ui.notify(`${INITIALIZATION_PENDING_REASON} ${session.reason}`, 'error')
        ctx.shutdown()
        return { cancel: true }
      }
      if (isInactive(ctx)) return undefined
      const notReady = readinessFailure(ctx)
      if (notReady !== undefined) {
        markInitializationFailed(ctx, session.sessionId, notReady)
        return { cancel: true }
      }
      ctx.ui.notify(PI_SESSION_BRANCH_BLOCK_MESSAGE, 'warning')
      return { cancel: true }
    }
    pi.on('session_before_tree', (_event, ctx) => blockSessionBranching(ctx))
    pi.on('session_before_fork', (_event, ctx) => blockSessionBranching(ctx))

    pi.registerTool({
      name: toolName,
      label: 'Workflow',
      description: 'Execute a deterministic workflow operation such as init, transition, or record-*.',
      promptSnippet: `Execute deterministic workflow operations with ${toolName}.`,
      parameters: workflowToolParameters,
      executionMode: 'sequential',
      async execute(_toolCallId, parameters, _signal, _onUpdate, ctx) {
        const result = runRoute(ctx, [parameters.operation, ...(parameters.args ?? [])], pi)
        if (result.exitCode === 0) automation.afterOperation(ctx)
        return {
          content: [{
            type: 'text',
            text: result.output,
          }],
          details: { exitCode: result.exitCode },
          isError: result.exitCode !== 0,
        }
      },
    })

    pi.registerCommand(commandName, {
      description: `Execute a deterministic workflow operation: /${commandName} <operation> [args]`,
      handler: async (rawArguments, ctx) => {
        try {
          const result = runRoute(ctx, parsePiCommandArguments(rawArguments), pi)
          if (result.exitCode === 0) automation.afterOperation(ctx)
          if (result.exitCode !== 0 || (!automation.ownsState(ctx) && readinessFailure(ctx) === undefined)) notifyRouteResult(ctx, pi, result)
        } catch (error: unknown) {
          ctx.ui.notify(String(error), 'error')
        }
      },
    })
    const automation = registerPiWorkflowAutomation(pi, {
      databasePath,
      ...(config.automation === undefined ? {} : { automation: config.automation }),
      isReady: (ctx) => readinessFailure(ctx) === undefined &&
        ownership.delegatedParent(ctx.sessionManager.getSessionId()) === undefined,
      getState: (ctx) => useEngine(ctx, (engine) => engine.getWorkflowState(ctx.sessionManager.getSessionId())),
      runOperation: (ctx, args) => runRoute(ctx, args, pi),
      retireContext: (ctx, reason) => {
        const session = readSessionId(ctx)
        if (!session.ok) return {
          type: 'error',
          output: session.reason,
        }
        return useEngine(ctx, (engine) => engine.retireContext(session.sessionId, reason))
      },
      isContextRetired: (ctx) => {
        const session = readSessionId(ctx)
        return session.ok && isContextRetiredFor(ctx, session.sessionId)
      },
      recordContextSuccessor: (successorSessionId, retiredSessionId, recordedAt) =>
        ownership.recordContextSuccessor(successorSessionId, retiredSessionId, recordedAt),
      fail: (ctx, reason) => markSafetyUnavailable(ctx, ctx.sessionManager.getSessionId(), reason),
    })
  }
}
