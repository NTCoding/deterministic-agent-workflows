import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { WorkflowEngine } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  createPreToolUseHandler,
  createWorkflowRunner,
  getRepositoryName,
  type PlatformContext,
  type RunnerResult,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { Type } from 'typebox'
import type {
  PiInitializationStatus,
  PiSessionIdResult,
  PiWorkflowExtension,
  PiWorkflowExtensionConfig,
} from '../../../platform/domain/pi-workflow-extension-types'
import { parsePiCommandArguments } from '../../../platform/domain/pi-command-arguments'
import {
  hasPiWorkflowMarker,
  PI_WORKFLOW_MARKER_CUSTOM_TYPE,
  type PiSessionMetadata,
  readPiSessionMetadata,
} from '../../../platform/infra/external-clients/pi/pi-session-file'
import {
  getLatestPiAssistantSettlement,
  type PiAssistantSettlement,
  PiTranscriptReader,
} from '../../../platform/infra/external-clients/pi/pi-transcript-reader'

const PI_QUESTION_TOOL = 'question'
const DEFAULT_COMMAND_NAME = 'workflow'
const DEFAULT_TOOL_NAME = 'workflow'
const INITIALIZATION_PENDING_REASON = 'Pi workflow initialization has not completed safely. Tool execution is blocked.'

export const PI_IDLE_RECOVERY_MESSAGE = 'You have stopped. You should never stop until the workflow is complete unless your current state permits stopping.'
export const PI_SESSION_BRANCH_BLOCK_MESSAGE = 'Pi session tree navigation and forks are disabled while a workflow is active.'

const workflowToolParameters = Type.Object({
  operation: Type.String({ description: 'Workflow operation, for example init or transition' }),
  args: Type.Optional(Type.Array(Type.String({ description: 'One workflow operation argument' }))),
})

function translationNote(toolName: string): string {
  return [
    `> **Pi**: When instructions say to run a workflow command, call the \`${toolName}\` tool instead:`,
    '> `operation: "<op>", args: ["<arg>", ...]`.',
    '',
    '---',
    '',
    '',
  ].join('\n')
}

function resolveDatabasePath(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const fromEnvironment = process.env['WORKFLOW_EVENTS_DB']
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment
  return join(homedir(), 'ai-workflow-database', '.workflow-events.db')
}

function readSessionId(ctx: ExtensionContext): PiSessionIdResult {
  try {
    const sessionId = ctx.sessionManager.getSessionId()
    if (sessionId.trim().length === 0) return {
      ok: false,
      reason: 'Pi returned an empty session UUID.',
    }
    return {
      ok: true,
      sessionId,
    }
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `Pi session UUID is unavailable: ${String(error)}`,
    }
  }
}

function requireSessionFile(ctx: ExtensionContext): string {
  const sessionFile = ctx.sessionManager.getSessionFile()
  if (sessionFile === undefined) throw new TypeError('Ephemeral Pi sessions are unsupported because no persistent transcript file is available.')
  return sessionFile
}

function notifyRouteResult(ctx: ExtensionContext, pi: ExtensionAPI, result: RunnerResult): void {
  if (result.exitCode !== 0) {
    ctx.ui.notify(result.output, 'error')
    return
  }
  if (result.output === '') {
    ctx.ui.notify('Workflow operation completed.', 'info')
    return
  }
  pi.sendUserMessage(result.output)
}

/** @riviere-role cli-entrypoint */
export function createPiWorkflowExtension<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
>(
  config: PiWorkflowExtensionConfig<TWorkflow, TState, TDeps, TStateName, TOperation>,
): PiWorkflowExtension {
  const databasePath = resolveDatabasePath(config.databasePath)
  const commandName = config.commandName ?? DEFAULT_COMMAND_NAME
  const toolName = config.toolName ?? DEFAULT_TOOL_NAME
  const initializationBySession = new Map<string, PiInitializationStatus>()
  const recoveredAssistantBySession = new Map<string, string>()
  const preToolUse = createPreToolUseHandler<TWorkflow, TState, TDeps, TStateName, TOperation>({
    bashForbidden: config.bashForbidden,
    isWriteAllowed: config.isWriteAllowed,
    questionToolName: PI_QUESTION_TOOL,
    customGates: config.customGates,
  })
  const runner = createWorkflowRunner({
    workflowDefinition: config.workflowDefinition,
    routes: config.routes,
    bashForbidden: config.bashForbidden,
    isWriteAllowed: config.isWriteAllowed,
    questionToolName: PI_QUESTION_TOOL,
    customGates: config.customGates,
  })

  function useEngine<TResult>(
    ctx: ExtensionContext,
    operation: (
      engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>,
      engineDeps: WorkflowEngineDeps,
      workflowDeps: TDeps,
    ) => TResult,
  ): TResult {
    const store = createStore(databasePath)
    try {
      const sessionId = ctx.sessionManager.getSessionId()
      const now = () => new Date().toISOString()
      const note = translationNote(toolName)
      const engineDeps: WorkflowEngineDeps = {
        store,
        getPluginRoot: () => config.pluginRoot,
        getEnvFilePath: () => join(config.pluginRoot, '.pi', 'unused.env'),
        getRepositoryName: () => getRepositoryName(ctx.cwd),
        readFile: (path) => `${note}${readFileSync(path, 'utf8')}`,
        appendToFile: () => undefined,
        now,
        transcriptReader: new PiTranscriptReader(() => ctx.sessionManager.getBranch()),
        sessionContext: {
          isSubagent: async () => false,
          getMainSessionId: async () => sessionId,
        },
      }
      const platform: PlatformContext = {
        getPluginRoot: () => config.pluginRoot,
        now,
        getSessionId: () => sessionId,
        store,
      }
      const workflowDeps = config.buildWorkflowDeps(platform)
      const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)
      return operation(engine, engineDeps, workflowDeps)
    } finally {
      store.db.close()
    }
  }

  function markInitializationFailed(ctx: ExtensionContext, sessionId: string, detail: string): string {
    const reason = `Pi workflow initialization failed: ${detail}`
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
    return status?.type === 'failed' ? status.reason : INITIALIZATION_PENDING_REASON
  }

  function parentSafetyFailure(event: SessionStartEvent, ctx: ExtensionContext): string | undefined {
    const parentSessionFile = ctx.sessionManager.getHeader()?.parentSession
    if (parentSessionFile === undefined) {
      return event.reason === 'fork' ? 'Forked Pi session has no verifiable parent session file.' : undefined
    }
    const parent: PiSessionMetadata = readPiSessionMetadata(parentSessionFile)
    const store = createStore(databasePath)
    try {
      return store.hasSessionStarted(parent.id) || parent.hasWorkflowMarker
        ? `Cannot fork Pi session ${parent.id}: its workflow is active.`
        : undefined
    } finally {
      store.db.close()
    }
  }

  function initializeSession(event: SessionStartEvent, ctx: ExtensionContext, pi: ExtensionAPI, sessionId: string): string | undefined {
    try {
      const sessionFile = requireSessionFile(ctx)
      const header = ctx.sessionManager.getHeader()
      if (header?.id !== sessionId) return 'Pi session header does not match the active session UUID.'
      const activeBranchHasWorkflowMarker = hasPiWorkflowMarker(ctx.sessionManager.getBranch())
      const sessionHasWorkflowMarker = hasPiWorkflowMarker(ctx.sessionManager.getEntries())
      const result = useEngine(ctx, (engine) => {
        const sqliteHasWorkflowState = engine.hasSessionStarted(sessionId)
        if (!sqliteHasWorkflowState) {
          const parentFailure = parentSafetyFailure(event, ctx)
          if (parentFailure !== undefined) return {
            type: 'error' as const,
            output: parentFailure,
          }
        }
        if (sessionHasWorkflowMarker && !activeBranchHasWorkflowMarker) return {
          type: 'error' as const,
          output: `The active Pi branch does not contain this session's ${PI_WORKFLOW_MARKER_CUSTOM_TYPE} marker.`,
        }
        if (activeBranchHasWorkflowMarker !== sqliteHasWorkflowState) return {
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

  function runRoute(ctx: ExtensionContext, args: readonly string[]): RunnerResult {
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
        output: markInitializationFailed(ctx, session.sessionId, `Workflow operation could not establish safe state: ${String(error)}`),
        exitCode: 1,
      }
    }
  }

  return (pi: ExtensionAPI): void => {
    pi.on('session_start', (event, ctx) => {
      const session = readSessionId(ctx)
      if (!session.ok) {
        ctx.ui.notify(`Pi workflow initialization failed: ${session.reason}`, 'error')
        ctx.shutdown()
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
          reason: markInitializationFailed(ctx, session.sessionId, `Tool safety could not be established: ${String(error)}`),
        }
      }
    })

    pi.on('input', (_event, ctx) => {
      const notReady = readinessFailure(ctx)
      if (notReady === undefined) return
      ctx.ui.notify(notReady, 'error')
      return { action: 'handled' }
    })

    pi.on('agent_settled', (_event, ctx) => {
      if (readinessFailure(ctx) !== undefined) return
      const session = readSessionId(ctx)
      if (!session.ok) return
      const settlement: PiAssistantSettlement | undefined = getLatestPiAssistantSettlement(ctx.sessionManager.getBranch())
      if (settlement?.stopReason !== 'stop') return
      if (recoveredAssistantBySession.get(session.sessionId) === settlement.id) return
      try {
        const result = useEngine(ctx, (engine) => engine.checkStopping(session.sessionId, 'stop'))
        if (result.type === 'blocked' && ctx.isIdle() && !ctx.hasPendingMessages()) {
          recoveredAssistantBySession.set(session.sessionId, settlement.id)
          pi.sendUserMessage(PI_IDLE_RECOVERY_MESSAGE)
        }
      } catch (error: unknown) {
        markInitializationFailed(ctx, session.sessionId, `Stopping safety could not be established: ${String(error)}`)
      }
    })

    const blockSessionBranching = (ctx: ExtensionContext): { readonly cancel: true } | undefined => {
      const session = readSessionId(ctx)
      if (!session.ok) {
        ctx.ui.notify(`${INITIALIZATION_PENDING_REASON} ${session.reason}`, 'error')
        ctx.shutdown()
        return { cancel: true }
      }
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
        const result = runRoute(ctx, [parameters.operation, ...(parameters.args ?? [])])
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
          const result = runRoute(ctx, parsePiCommandArguments(rawArguments))
          notifyRouteResult(ctx, pi, result)
        } catch (error: unknown) {
          ctx.ui.notify(String(error), 'error')
        }
      },
    })
  }
}
