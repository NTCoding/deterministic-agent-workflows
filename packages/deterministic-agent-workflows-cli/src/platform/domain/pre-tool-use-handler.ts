import type {
  BaseWorkflowState,
  EngineResult,
  RehydratableWorkflow,
  WorkflowEngine,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { BashForbiddenConfig } from '@nt-ai-lab/deterministic-agent-workflow-dsl'

const BASH_TOOL_NAMES = ['Bash', 'bash']
const WRITE_TOOL_NAMES = [
  // Claude Code
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  // OpenCode and Codex
  'write', 'edit', 'apply_patch',
]

type PreToolUseEngine<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
> = Pick<WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>, 'transaction' | 'checkBash' | 'checkWrite'>

/** @riviere-role value-object */
export type PreToolUseHandlerFn<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> = (
  engine: PreToolUseEngine<TWorkflow, TState, TDeps, TStateName, TOperation>,
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
) => EngineResult

/** @riviere-role value-object */
export type CustomPreToolUseGate<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TStateName extends string = string,
> = {
  readonly name: string
  readonly check: (workflow: TWorkflow, ctx: {
    readonly toolName: string;
    readonly filePath: string;
    readonly command: string 
  }) => true | string
}

/** @riviere-role value-object */
export type PreToolUseHandlerConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TStateName extends string = string,
> = {
  readonly bashForbidden: BashForbiddenConfig
  readonly isWriteAllowed: (filePath: string, state: TState) => boolean
  readonly customGates?: readonly CustomPreToolUseGate<TWorkflow, TState, TStateName>[]
}

/** @riviere-role domain-service */
export function createPreToolUseHandler<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
>(
  config: PreToolUseHandlerConfig<TWorkflow, TState, TStateName>,
): PreToolUseHandlerFn<TWorkflow, TState, TDeps, TStateName, TOperation> {
  return (engine, sessionId, toolName, toolInput) => {
    const command = extractCommand(toolInput)
    const isWriteTool = WRITE_TOOL_NAMES.includes(toolName)
    const filePaths = isWriteTool ? extractFilePaths(toolName, toolInput) : [extractFilePath(toolInput)]

    const gateResult = checkCustomGates(config, engine, sessionId, toolName, command, filePaths)
    if (gateResult !== undefined) return gateResult

    if (BASH_TOOL_NAMES.includes(toolName)) return engine.checkBash(sessionId, toolName, command, config.bashForbidden)
    if (!isWriteTool) {
      return {
        type: 'success',
        output: '',
      }
    }
    if (filePaths.length === 0) {
      return {
        type: 'blocked',
        output: `Cannot determine every file edited by ${toolName}.`,
      }
    }
    for (const filePath of filePaths) {
      const result = engine.checkWrite(sessionId, toolName, filePath, config.isWriteAllowed)
      if (result.type === 'blocked') return result
    }
    return {
      type: 'success',
      output: '',
    }
  }
}

function checkCustomGates<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(
  config: PreToolUseHandlerConfig<TWorkflow, TState, TStateName>,
  engine: PreToolUseEngine<TWorkflow, TState, TDeps, TStateName, TOperation>,
  sessionId: string,
  toolName: string,
  command: string,
  filePaths: readonly string[],
): EngineResult | undefined {
  for (const filePath of filePaths.length === 0 ? [''] : filePaths) {
    const ctx = {
      toolName,
      filePath,
      command,
    }
    for (const gate of config.customGates ?? []) {
      const result = engine.transaction(
        sessionId,
        `hook:${gate.name}`,
        (workflow) => {
          const check = gate.check(workflow, ctx)
          if (check === true) return { pass: true as const }
          return {
            pass: false as const,
            reason: check,
          }
        },
      )
      if (result.type === 'blocked') return result
    }
  }
  return undefined
}

function extractFilePath(toolInput: Record<string, unknown>): string {
  return resolveStringField(toolInput['file_path'])
    || resolveStringField(toolInput['filePath'])
    || resolveStringField(toolInput['path'])
    || resolveStringField(toolInput['pattern'])
}

function extractFilePaths(toolName: string, toolInput: Record<string, unknown>): readonly string[] {
  const filePath = extractFilePath(toolInput)
  if (filePath.length > 0) return [filePath]
  if (toolName !== 'apply_patch') return []

  const patchText = resolveStringField(toolInput['patchText']) || resolveStringField(toolInput['command'])
  const paths = new Set<string>()
  for (const line of patchText.split('\n')) {
    const match = /^\*\*\* (?:Update|Add|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/.exec(line)
    const path = match?.[1] ?? match?.[2]
    if (path !== undefined && path.trim().length > 0) paths.add(path.trim())
  }
  return [...paths]
}

function extractCommand(toolInput: Record<string, unknown>): string {
  return resolveStringField(toolInput['command']) || resolveStringField(toolInput['patchText'])
}

function resolveStringField(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  throw new TypeError(`Expected string or undefined in tool_input field. Got ${typeof value}: ${String(value)}`)
}
