import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type {
  BaseWorkflowState,
  EngineResult,
  RehydratableWorkflow,
  TranscriptReader,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  reduceWorkflowStateFromStoredEvents,
  WorkflowEngine,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  createPreToolUseHandler,
  createWorkflowRunner,
  formatContextInjection,
  formatDenyDecision,
  getRepositoryName,
  type PlatformContext,
  type PreToolUseHandlerFn,
  type ProcessDeps,
  type RunnerResult,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type { CodexWorkflowCliConfig } from '../../../platform/domain/codex-workflow-cli-types'
import {
  codexHookInputSchema,
  codexPreToolUseInputSchema,
  codexSubagentStartInputSchema,
} from '../../../platform/infra/external-clients/codex/codex-hook-schemas'

const EMPTY_TRANSCRIPT_READER: TranscriptReader = { readMessages: () => [] }

/** @riviere-role cli-entrypoint */
export function createCodexWorkflowCli<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
>(config: CodexWorkflowCliConfig<TWorkflow, TState, TDeps, TStateName, TOperation>): void {
  const root = config.workflowRoot ?? resolveWorkflowRoot()
  const databasePath = resolveDatabasePath(config.processDeps)
  const store = config.processDeps.buildStore(databasePath)
  const now = () => new Date().toISOString()
  const engineDeps: WorkflowEngineDeps = {
    store,
    getPluginRoot: () => root,
    getEnvFilePath: () => join(root, '.codex', 'unused.env'),
    readFile: config.processDeps.readFile,
    appendToFile: config.processDeps.appendToFile,
    now,
    transcriptReader: config.transcriptReader ?? EMPTY_TRANSCRIPT_READER,
  }
  const platform: PlatformContext = {
    getPluginRoot: () => root,
    now,
    getSessionId: () => {
      throw new TypeError('Codex workflow commands require an explicit session id')
    },
    store,
  }
  const workflowDeps = config.buildWorkflowDeps(platform)
  const args = config.processDeps.getArgv().slice(2)

  try {
    const result = args.length === 0
      ? handleHook(config, engineDeps, workflowDeps)
      : createWorkflowRunner(config)(args, engineDeps, workflowDeps)
    writeResult(config.processDeps, result)
  } catch (error: unknown) {
    config.processDeps.writeStderr(`[${now()}] ERROR: ${String(error)}\n`)
    config.processDeps.exit(1)
  }
}

function resolveWorkflowRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    return process.cwd()
  }
}

function resolveDatabasePath(processDeps: ProcessDeps): string {
  const configured = processDeps.getEnv('WORKFLOW_EVENTS_DB')
  if (configured !== undefined && configured !== '') return configured
  const home = processDeps.getEnv('HOME')
  if (home === undefined || home === '') throw new TypeError('Missing required environment variable: HOME')
  return join(home, '.workflow-events.db')
}

function handleHook<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(config: CodexWorkflowCliConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, engineDeps: WorkflowEngineDeps, workflowDeps: TDeps): RunnerResult {
  const raw = config.processDeps.readFile('/dev/stdin')
  const parsed = codexHookInputSchema.parse(JSON.parse(raw))
  const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)
  switch (parsed.hook_event_name) {
    case 'SessionStart': return startSession(config, engine, parsed.session_id, parsed.transcript_path, parsed.cwd)
    case 'PreToolUse': return checkToolUse(config, engine, raw)
    case 'SubagentStart': return registerSubagent(engine, raw)
    case 'Stop': return preventUnsupportedStop(config, engineDeps, parsed.session_id)
  }
}

function startSession<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(config: CodexWorkflowCliConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, sessionId: string, transcriptPath: string | null, cwd: string): RunnerResult {
  if (!engine.hasSessionStarted(sessionId)) {
    const result = engine.startSession(sessionId, transcriptPath ?? '', getRepositoryName(cwd))
    if (result.type !== 'success') return toRunnerResult(result)
  }
  return {
    output: formatContextInjection(`Workflow session: ${sessionId}. Use ${config.workflowCommand} transition ${sessionId} <STATE> for transitions, or ${config.workflowCommand} <OPERATION> ${sessionId} <ARGS> for workflow operations.`),
    exitCode: 0,
  }
}

function checkToolUse<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(config: CodexWorkflowCliConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, raw: string): RunnerResult {
  const input = codexPreToolUseInputSchema.parse(JSON.parse(raw))
  if (!engine.hasSessionStarted(input.session_id)) return { output: '', exitCode: 0 }
  const handler = resolvePreToolUseHandler(config)
  if (handler === undefined) return { output: '', exitCode: 0 }
  if (input.tool_name === 'apply_patch') return checkPatchPaths(handler, engine, input.session_id, input.tool_input)
  return toHookResult(handler(engine, input.session_id, input.tool_name, input.tool_input))
}

function resolvePreToolUseHandler<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(config: CodexWorkflowCliConfig<TWorkflow, TState, TDeps, TStateName, TOperation>): PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation> | undefined {
  if (config.bashForbidden === undefined && config.isWriteAllowed === undefined) {
    if (config.customGates !== undefined) {
      throw new TypeError('CodexWorkflowCliConfig: customGates requires bashForbidden and isWriteAllowed.')
    }
    return undefined
  }
  if (config.bashForbidden === undefined || config.isWriteAllowed === undefined) {
    throw new TypeError('CodexWorkflowCliConfig: bashForbidden and isWriteAllowed must be provided together.')
  }
  return createPreToolUseHandler({
    bashForbidden: config.bashForbidden,
    isWriteAllowed: config.isWriteAllowed,
    customGates: config.customGates,
  })
}

function checkPatchPaths<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(handler: PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation>, engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, sessionId: string, toolInput: Record<string, unknown>): RunnerResult {
  const command = toolInput.command
  if (typeof command !== 'string') return deny('Codex apply_patch hook is missing tool_input.command')
  const paths = extractPatchPaths(command)
  if (paths.length === 0) return deny('Cannot determine every file edited by Codex apply_patch')
  for (const path of paths) {
    const result = handler(engine, sessionId, 'Write', { file_path: path })
    if (result.type === 'blocked') return toHookResult(result)
  }
  return { output: '', exitCode: 0 }
}

function extractPatchPaths(command: string): readonly string[] {
  const paths = new Set<string>()
  for (const line of command.split('\n')) {
    const match = /^\*\*\* Update File: (.+)$|^\*\*\* Add File: (.+)$|^\*\*\* Delete File: (.+)$/.exec(line)
    const path = match?.[1] ?? match?.[2] ?? match?.[3]
    if (path !== undefined && path !== '') paths.add(path)
  }
  return [...paths]
}

function registerSubagent<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, raw: string): RunnerResult {
  const input = codexSubagentStartInputSchema.parse(JSON.parse(raw))
  if (!engine.hasSessionStarted(input.session_id)) return { output: '', exitCode: 0 }
  const result = engine.transaction(input.session_id, 'register-agent', (workflow) => workflow.registerAgent(input.agent_type, input.agent_id))
  return {
    output: formatContextInjection(result.type === 'success' ? result.output : ''),
    exitCode: 0,
  }
}

function preventUnsupportedStop<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(config: CodexWorkflowCliConfig<TWorkflow, TState, TDeps, TStateName, TOperation>, engineDeps: WorkflowEngineDeps, sessionId: string): RunnerResult {
  const stored = engineDeps.store.readEvents(sessionId)
  if (!engineDeps.store.hasSessionStarted(sessionId)) return { output: '', exitCode: 0 }
  const state = reduceWorkflowStateFromStoredEvents(config.workflowDefinition, stored)
  if (config.workflowDefinition.getRegistry()[state.currentStateMachineState].allowIdle === true) return { output: '', exitCode: 0 }
  return {
    output: JSON.stringify({ continue: false, stopReason: `Workflow state ${state.currentStateMachineState} does not allow stopping.` }),
    exitCode: 0,
  }
}

function toHookResult(result: EngineResult): RunnerResult {
  if (result.type === 'blocked') return deny(result.output)
  return toRunnerResult(result)
}

function toRunnerResult(result: EngineResult): RunnerResult {
  return { output: result.output, exitCode: result.type === 'success' ? 0 : 1 }
}

function deny(reason: string): RunnerResult {
  return { output: formatDenyDecision(reason), exitCode: 0 }
}

function writeResult(processDeps: ProcessDeps, result: RunnerResult): void {
  if (result.output !== '') processDeps.writeStdout(result.output)
  processDeps.exit(result.exitCode)
}
