import { checkBashCommand } from './bash-enforcement'
import { checkIdentity } from './identity-verification'
import {
  formatIdentityReminder,
  formatOperationGateError,
  formatOperationSuccess,
} from '../infra/cli/presentation/output-guidance'
import {
  buildPrefixPattern,
  buildProcedurePath,
  getExpectedPrefix,
} from './workflow-engine-support'
import type { BaseWorkflowState } from './workflow-state'
import type { BashForbiddenConfig } from './workflow-registry'
import type {
  EngineResult,
  RehydratableWorkflow,
  WorkflowDefinition,
  WorkflowEngineDeps,
} from './workflow-engine-types'

type PlatformOperationContext<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
> = {
  readonly workflow: TWorkflow
  readonly engineDeps: WorkflowEngineDeps
  readonly factory: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>
  readonly persistPlatformEvent: (event: unknown) => void
}

/** @riviere-role domain-service */
export function writeJournalWithPlatformEvents<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(
  context: PlatformOperationContext<TWorkflow, TState, TDeps, TStateName, TOperation>,
  agentName: string,
  content: string,
): EngineResult {
  context.persistPlatformEvent({
    type: 'journal-entry',
    at: context.engineDeps.now(),
    agentName,
    content,
  })
  const state = context.workflow.getState()
  const body = context.factory.getOperationBody?.('write-journal', state) ?? 'Write journal entry'
  return {
    type: 'success',
    output: formatOperationSuccess(
      'write-journal',
      body,
      getExpectedPrefix(state.currentStateMachineState, context.factory.getRegistry()),
    ),
  }
}

/** @riviere-role domain-service */
export function checkBashWithPlatformEvents<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(
  context: PlatformOperationContext<TWorkflow, TState, TDeps, TStateName, TOperation>,
  toolName: string,
  command: string,
  bashForbidden: BashForbiddenConfig,
): EngineResult {
  const state = context.workflow.getState()
  const currentStateName = state.currentStateMachineState
  const currentPrefix = getExpectedPrefix(currentStateName, context.factory.getRegistry())
  if (toolName !== 'Bash') {
    context.persistPlatformEvent({
      type: 'bash-checked',
      at: context.engineDeps.now(),
      tool: toolName,
      command,
      allowed: true,
    })
    return {
      type: 'success',
      output: '',
    }
  }

  const exemptions = context.factory.getRegistry()[currentStateName].allowForbidden?.bash ?? []
  const bashCheckResult = checkBashCommand(command, bashForbidden, exemptions)
  if (!bashCheckResult.pass) {
    const reason = `Bash command blocked in ${currentStateName}. ${bashCheckResult.reason}`
    context.persistPlatformEvent({
      type: 'bash-checked',
      at: context.engineDeps.now(),
      tool: toolName,
      command,
      allowed: false,
      reason,
    })
    return {
      type: 'blocked',
      output: formatOperationGateError('bash-check', reason, currentPrefix),
    }
  }

  context.persistPlatformEvent({
    type: 'bash-checked',
    at: context.engineDeps.now(),
    tool: toolName,
    command,
    allowed: true,
  })
  return {
    type: 'success',
    output: '',
  }
}

/** @riviere-role domain-service */
export function checkWriteWithPlatformEvents<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(
  context: PlatformOperationContext<TWorkflow, TState, TDeps, TStateName, TOperation>,
  toolName: string,
  filePath: string,
  isWriteAllowed: (filePath: string, state: TState) => boolean,
): EngineResult {
  const state = context.workflow.getState()
  const currentStateName = state.currentStateMachineState
  const currentPrefix = getExpectedPrefix(currentStateName, context.factory.getRegistry())

  const writeTools = new Set(['Write', 'Edit', 'NotebookEdit'])
  if (!writeTools.has(toolName)) {
    context.persistPlatformEvent({
      type: 'write-checked',
      at: context.engineDeps.now(),
      tool: toolName,
      filePath,
      allowed: true,
    })
    return {
      type: 'success',
      output: '',
    }
  }

  const storePath = `${context.engineDeps.getPluginRoot()}/workflow.db`
  if (filePath === storePath) {
    context.persistPlatformEvent({
      type: 'write-checked',
      at: context.engineDeps.now(),
      tool: toolName,
      filePath,
      allowed: true,
    })
    return {
      type: 'success',
      output: '',
    }
  }

  if (!(context.factory.getRegistry()[currentStateName].forbidden?.write ?? false)) {
    context.persistPlatformEvent({
      type: 'write-checked',
      at: context.engineDeps.now(),
      tool: toolName,
      filePath,
      allowed: true,
    })
    return {
      type: 'success',
      output: '',
    }
  }

  if (!isWriteAllowed(filePath, state)) {
    const reason = `Write to '${filePath}' is forbidden in state ${currentStateName}`
    context.persistPlatformEvent({
      type: 'write-checked',
      at: context.engineDeps.now(),
      tool: toolName,
      filePath,
      allowed: false,
      reason,
    })
    return {
      type: 'blocked',
      output: formatOperationGateError('write-check', reason, currentPrefix),
    }
  }

  context.persistPlatformEvent({
    type: 'write-checked',
    at: context.engineDeps.now(),
    tool: toolName,
    filePath,
    allowed: true,
  })
  return {
    type: 'success',
    output: '',
  }
}

/** @riviere-role domain-service */
export function checkMessageWithPlatformEvents<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(
  context: PlatformOperationContext<TWorkflow, TState, TDeps, TStateName, TOperation>,
): EngineResult {
  const state = context.workflow.getState()
  const currentStateName = state.currentStateMachineState
  const transcriptPath = context.workflow.getTranscriptPath()
  const pattern = buildPrefixPattern(context.factory.getRegistry())
  const messages = context.engineDeps.transcriptReader.readMessages(transcriptPath)
  const identityCheckResult = checkIdentity(messages, pattern)

  context.persistPlatformEvent({
    type: 'identity-verified',
    at: context.engineDeps.now(),
    status: identityCheckResult.status,
    transcriptPath,
  })

  if (identityCheckResult.status === 'lost') {
    return {
      type: 'blocked',
      output: formatIdentityReminder(
        getExpectedPrefix(currentStateName, context.factory.getRegistry()),
        buildProcedurePath(context.engineDeps, currentStateName),
      ),
    }
  }

  return {
    type: 'success',
    output: '',
  }
}
