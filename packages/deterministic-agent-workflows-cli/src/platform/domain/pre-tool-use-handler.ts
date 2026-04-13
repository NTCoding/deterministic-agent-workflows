import type {
  BaseWorkflowState,
  EngineResult,
  RehydratableWorkflow,
  WorkflowEngine,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { BashForbiddenConfig } from '@nt-ai-lab/deterministic-agent-workflow-dsl'

/** @riviere-role value-object */
export type PreToolUseHandlerFn<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> = (
  engine: WorkflowEngine<TWorkflow, TState, TDeps, TStateName, TOperation>,
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
    const filePath = extractFilePath(toolInput)
    const command = extractCommand(toolInput)
    const ctx = {
      toolName,
      filePath,
      command 
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
            reason: check 
          }
        },
      )
      if (result.type === 'blocked') return result
    }

    const writeCheck = engine.checkWrite(sessionId, toolName, filePath, config.isWriteAllowed)
    if (writeCheck.type === 'blocked') return writeCheck

    return engine.checkBash(sessionId, toolName, command, config.bashForbidden)
  }
}

function extractFilePath(toolInput: Record<string, unknown>): string {
  return resolveStringField(toolInput['file_path'])
    || resolveStringField(toolInput['path'])
    || resolveStringField(toolInput['pattern'])
}

function extractCommand(toolInput: Record<string, unknown>): string {
  return resolveStringField(toolInput['command'])
}

function resolveStringField(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  throw new TypeError(`Expected string or undefined in tool_input field. Got ${typeof value}: ${String(value)}`)
}
