import { checkBashCommand } from './bash-enforcement'
import { checkIdentity } from './identity-verification'
import {
  buildPrefixPattern,
  buildProcedurePath,
  enrichSessionStartedEvents,
  getExpectedPrefix,
  readProcedure,
} from './workflow-engine-support'
import {
  formatIllegalTransitionError,
  formatInitSuccess,
  formatOperationGateError,
  formatOperationSuccess,
  formatTransitionError,
  formatTransitionSuccess,
} from '../infra/cli/presentation/output-guidance'
import type { PreconditionResult } from './precondition-result'
import type { BashForbiddenConfig } from './workflow-registry'
import type {
  EngineResult,
  RehydratableWorkflow,
  WorkflowDefinition,
  WorkflowEngineDeps,
} from './workflow-engine-types'
import type { BaseWorkflowState } from './workflow-state'
import { WorkflowStateError } from './workflow-state'

/** @riviere-role domain-service */
export class WorkflowEngine<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> {
  constructor(
    private readonly factory: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>,
    private readonly engineDeps: WorkflowEngineDeps,
    private readonly workflowDeps: TDeps,
  ) {}

  startSession(sessionId: string, transcriptPath: string, repository?: string): EngineResult {
    if (this.engineDeps.store.hasSessionStarted(sessionId)) {
      return {
        type: 'success',
        output: '' 
      }
    }

    const initialState = this.factory.initialState()
    const workflow = this.factory.buildWorkflow(initialState, this.workflowDeps)
    const resolvedRepository = repository ?? this.engineDeps.getRepositoryName?.()
    if (resolvedRepository === undefined || resolvedRepository === '') {
      return {
        type: 'error',
        output: 'Could not determine repository name for session-started event.' 
      }
    }

    workflow.startSession(transcriptPath, resolvedRepository)
    const registry = this.factory.getRegistry()
    const stateNames = Object.keys(registry)
    const pendingEvents = enrichSessionStartedEvents(
      this.engineDeps,
      workflow.getPendingEvents(),
      transcriptPath,
      resolvedRepository,
      initialState.currentStateMachineState,
      stateNames,
    )

    this.engineDeps.store.appendEvents(sessionId, pendingEvents)

    const procedureContent = this.engineDeps.readFile(
      buildProcedurePath(this.engineDeps, initialState.currentStateMachineState),
    )
    const expectedPrefix = getExpectedPrefix(initialState.currentStateMachineState, registry)
    return {
      type: 'success',
      output: formatInitSuccess(procedureContent, expectedPrefix) 
    }
  }

  transaction(
    sessionId: string,
    op: string,
    fn: (workflow: TWorkflow) => PreconditionResult,
  ): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const registry = this.factory.getRegistry()
    const identityResult = this.verifyIdentity(sessionId, workflow)
    if (identityResult !== undefined) {
      this.persistEvents(sessionId, workflow)
      const currentPrefix = getExpectedPrefix(workflow.getState().currentStateMachineState, registry)
      return {
        type: 'blocked',
        output: formatOperationGateError(op, identityResult, currentPrefix) 
      }
    }

    const result = fn(workflow)
    this.persistEvents(sessionId, workflow)
    const currentPrefix = getExpectedPrefix(workflow.getState().currentStateMachineState, registry)
    if (!result.pass) {
      return {
        type: 'blocked',
        output: formatOperationGateError(op, result.reason, currentPrefix) 
      }
    }

    const body = this.factory.getOperationBody?.(op, workflow.getState()) ?? op
    return {
      type: 'success',
      output: formatOperationSuccess(op, body, currentPrefix) 
    }
  }

  transition(sessionId: string, target: TStateName): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const state = workflow.getState()
    const currentStateName = state.currentStateMachineState
    const registry = this.factory.getRegistry()

    const identityResult = this.verifyIdentity(sessionId, workflow)
    if (identityResult !== undefined) {
      this.persistEvents(sessionId, workflow)
      const currentPrefix = getExpectedPrefix(currentStateName, registry)
      return {
        type: 'blocked',
        output: formatOperationGateError('transition', identityResult, currentPrefix) 
      }
    }

    const currentDef = registry[currentStateName]
    if (!currentDef.canTransitionTo.includes(target)) {
      const legalTargets = currentDef.canTransitionTo
      const reason = `Illegal transition ${currentStateName} -> ${target}. Legal targets from ${currentStateName}: [${legalTargets.join(', ') || 'none'}].`
      const currentProcedure = readProcedure(this.engineDeps, workflow.getState().currentStateMachineState)
      const currentPrefix = getExpectedPrefix(currentStateName, registry)
      return {
        type: 'blocked',
        output: formatIllegalTransitionError(reason, currentProcedure, currentPrefix) 
      }
    }

    if (target !== 'BLOCKED' && currentDef.transitionGuard) {
      const context = this.factory.buildTransitionContext(state, currentStateName, target, this.workflowDeps)
      const guardResult = currentDef.transitionGuard(context)
      if (!guardResult.pass) {
        const currentProcedure = readProcedure(this.engineDeps, workflow.getState().currentStateMachineState)
        const currentPrefix = getExpectedPrefix(currentStateName, registry)
        return {
          type: 'blocked',
          output: formatTransitionError(target, guardResult.reason, currentProcedure, currentPrefix),
        }
      }
    }

    const targetDef = registry[target]
    const stateBefore = workflow.getState()
    const context = this.factory.buildTransitionContext(stateBefore, currentStateName, target, this.workflowDeps)
    const stateAfter = targetDef.onEntry ? targetDef.onEntry(stateBefore, context) : stateBefore

    const transitionEvent = this.factory.buildTransitionEvent
      ? this.factory.buildTransitionEvent(currentStateName, target, stateBefore, stateAfter, this.engineDeps.now())
      : {
        type: 'transitioned',
        at: this.engineDeps.now(),
        from: currentStateName,
        to: target 
      }

    workflow.appendEvent(transitionEvent)
    targetDef.afterEntry?.()
    this.persistEvents(sessionId, workflow)

    const newState = workflow.getState()
    const title = this.factory.getTransitionTitle?.(newState.currentStateMachineState, newState)
      ?? newState.currentStateMachineState
    const procedure = readProcedure(this.engineDeps, workflow.getState().currentStateMachineState)
    const newPrefix = getExpectedPrefix(newState.currentStateMachineState, registry)
    return {
      type: 'success',
      output: formatTransitionSuccess(title, procedure, newPrefix) 
    }
  }

  checkBash(
    sessionId: string,
    toolName: string,
    command: string,
    bashForbidden: BashForbiddenConfig,
  ): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const registry = this.factory.getRegistry()
    const currentStateName = workflow.getState().currentStateMachineState
    const currentPrefix = getExpectedPrefix(currentStateName, registry)

    const identityResult = this.verifyIdentity(sessionId, workflow)
    if (identityResult !== undefined) {
      this.persistEvents(sessionId, workflow)
      return {
        type: 'blocked',
        output: formatOperationGateError('bash-check', identityResult, currentPrefix) 
      }
    }

    if (toolName !== 'Bash') {
      workflow.appendEvent({
        type: 'bash-checked',
        at: this.engineDeps.now(),
        tool: toolName,
        command,
        allowed: true 
      })
      this.persistEvents(sessionId, workflow)
      return {
        type: 'success',
        output: '' 
      }
    }

    const exemptions = registry[currentStateName].allowForbidden?.bash ?? []
    const result = checkBashCommand(command, bashForbidden, exemptions)
    if (!result.pass) {
      const reason = `Bash command blocked in ${currentStateName}. ${result.reason}`
      workflow.appendEvent({
        type: 'bash-checked',
        at: this.engineDeps.now(),
        tool: toolName,
        command,
        allowed: false,
        reason,
      })
      this.persistEvents(sessionId, workflow)
      return {
        type: 'blocked',
        output: formatOperationGateError('bash-check', reason, currentPrefix) 
      }
    }

    workflow.appendEvent({
      type: 'bash-checked',
      at: this.engineDeps.now(),
      tool: toolName,
      command,
      allowed: true 
    })
    this.persistEvents(sessionId, workflow)
    return {
      type: 'success',
      output: '' 
    }
  }

  checkWrite(
    sessionId: string,
    toolName: string,
    filePath: string,
    isWriteAllowed: (filePath: string, state: TState) => boolean,
  ): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const registry = this.factory.getRegistry()
    const currentStateName = workflow.getState().currentStateMachineState
    const currentPrefix = getExpectedPrefix(currentStateName, registry)

    const identityResult = this.verifyIdentity(sessionId, workflow)
    if (identityResult !== undefined) {
      this.persistEvents(sessionId, workflow)
      return {
        type: 'blocked',
        output: formatOperationGateError('write-check', identityResult, currentPrefix) 
      }
    }

    const writeTools = new Set(['Write', 'Edit', 'NotebookEdit'])
    if (!writeTools.has(toolName)) {
      workflow.appendEvent({
        type: 'write-checked',
        at: this.engineDeps.now(),
        tool: toolName,
        filePath,
        allowed: true 
      })
      this.persistEvents(sessionId, workflow)
      return {
        type: 'success',
        output: '' 
      }
    }

    const storePath = `${this.engineDeps.getPluginRoot()}/workflow.db`
    if (filePath === storePath) {
      workflow.appendEvent({
        type: 'write-checked',
        at: this.engineDeps.now(),
        tool: toolName,
        filePath,
        allowed: true 
      })
      this.persistEvents(sessionId, workflow)
      return {
        type: 'success',
        output: '' 
      }
    }

    if (!(registry[currentStateName].forbidden?.write ?? false)) {
      workflow.appendEvent({
        type: 'write-checked',
        at: this.engineDeps.now(),
        tool: toolName,
        filePath,
        allowed: true 
      })
      this.persistEvents(sessionId, workflow)
      return {
        type: 'success',
        output: '' 
      }
    }

    if (!isWriteAllowed(filePath, workflow.getState())) {
      const reason = `Write to '${filePath}' is forbidden in state ${currentStateName}`
      workflow.appendEvent({
        type: 'write-checked',
        at: this.engineDeps.now(),
        tool: toolName,
        filePath,
        allowed: false,
        reason,
      })
      this.persistEvents(sessionId, workflow)
      return {
        type: 'blocked',
        output: formatOperationGateError('write-check', reason, currentPrefix) 
      }
    }

    workflow.appendEvent({
      type: 'write-checked',
      at: this.engineDeps.now(),
      tool: toolName,
      filePath,
      allowed: true 
    })
    this.persistEvents(sessionId, workflow)
    return {
      type: 'success',
      output: '' 
    }
  }

  persistSessionId(sessionId: string): void {
    this.engineDeps.appendToFile(this.engineDeps.getEnvFilePath(), `export CLAUDE_SESSION_ID='${sessionId}'\n`)
  }

  hasSession(sessionId: string): boolean {
    return this.engineDeps.store.hasSessionStarted(sessionId)
  }

  hasSessionStarted(sessionId: string): boolean {
    return this.engineDeps.store.hasSessionStarted(sessionId)
  }

  private requireSession(sessionId: string): void {
    if (!this.engineDeps.store.hasSessionStarted(sessionId)) {
      throw new WorkflowStateError(`No session found for '${sessionId}'. Run init first.`)
    }
  }

  private rehydrateFromEvents(sessionId: string): TWorkflow {
    const events = this.engineDeps.store.readEvents(sessionId)
    const state = events.reduce<TState>(
      (accumulator, event) => this.factory.fold(accumulator, event),
      this.factory.initialState(),
    )
    return this.factory.buildWorkflow(state, this.workflowDeps)
  }

  private persistEvents(sessionId: string, workflow: TWorkflow): void {
    const pending = workflow.getPendingEvents()
    if (pending.length > 0) {
      this.engineDeps.store.appendEvents(sessionId, pending)
    }
  }

  private verifyIdentity(sessionId: string, workflow: TWorkflow): string | undefined {
    const transcriptPath = workflow.getTranscriptPath()
    const state = workflow.getState().currentStateMachineState
    const registry = this.factory.getRegistry()
    const expectedPrefix = getExpectedPrefix(state, registry)
    const pattern = buildPrefixPattern(registry)
    const messages = this.engineDeps.transcriptReader.readMessages(transcriptPath)
    const result = checkIdentity(messages, pattern)

    this.engineDeps.store.appendEvents(sessionId, [{
      type: 'identity-verified',
      at: this.engineDeps.now(),
      status: result.status,
      transcriptPath,
    }])

    if (result.status === 'lost') {
      return `You forgot. Next message MUST begin with: ${expectedPrefix}`
    }

    return undefined
  }
}
