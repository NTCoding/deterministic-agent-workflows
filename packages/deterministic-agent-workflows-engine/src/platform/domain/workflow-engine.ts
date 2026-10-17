import {
  checkBashWithPlatformEvents,
  checkStopAllowed,
  checkWriteWithPlatformEvents,
  type StoppingAction,
  writeJournalWithPlatformEvents,
} from './workflow-engine-platform-operations'
import {
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
import type {
  BashForbiddenConfig,
  TransitionContext,
} from './workflow-registry'
import type {
  EngineResult,
  RehydratableWorkflow,
  WorkflowDefinition,
  WorkflowEngineDeps,
} from './workflow-engine-types'
import type { BaseEvent } from './base-event'
import {
  toPayload,
  type StoredEvent,
} from './stored-event'
import { engineEventSchema } from './engine-events'
import {
  WorkflowStateError,
  type BaseWorkflowState,
} from './workflow-state'
import { reduceWorkflowStateFromStoredEvents } from './workflow-state-reducer'
import { serializeWorkflowState } from './workflow-state-serialization'
import { requireNonEmptyString } from './non-empty-string'

/** @riviere-role domain-service */
export class WorkflowEngine<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
  TTransitionContext extends TransitionContext<TState, TStateName> = TransitionContext<TState, TStateName>,
> {
  constructor(
    private readonly factory: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>,
    private readonly engineDeps: WorkflowEngineDeps,
    private readonly workflowDeps: TDeps,
  ) {}

  startSession(sessionId: string, transcriptPath: string, repository: string): EngineResult {
    const validSessionId = this.resolveSessionId(requireNonEmptyString(sessionId, 'sessionId'))
    const validTranscriptPath = requireNonEmptyString(transcriptPath, 'transcriptPath')
    const validRepository = requireNonEmptyString(repository, 'repository')
    if (this.engineDeps.store.hasSessionStarted(validSessionId)) {
      return {
        type: 'success',
        output: '' 
      }
    }

    const initialState = this.factory.initialState()
    const workflow = this.factory.buildWorkflow(initialState, this.workflowDeps)
    workflow.startSession(validTranscriptPath, validRepository)
    const registry = this.factory.getRegistry()
    const stateNames = Object.keys(registry)
    const pendingEvents = enrichSessionStartedEvents(
      this.engineDeps,
      workflow.getPendingEvents(),
      validTranscriptPath,
      validRepository,
      initialState.currentStateMachineState,
      stateNames,
    )

    this.engineDeps.store.appendEvents(validSessionId, this.wrapEvents(pendingEvents, initialState))

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
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const registry = this.factory.getRegistry()

    const result = this.runOperationCallback(() => fn(workflow))
    if ('type' in result) return result
    this.persistEvents(sessionId, workflow)
    try {
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
    } catch (error: unknown) {
      return this.committedResponseError(error)
    }
  }
  writeJournal(sessionId: string, agentName: string, content: string): EngineResult {
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return writeJournalWithPlatformEvents(this.platformOperationContext(sessionId, workflow), agentName, content)
  }
  transition(sessionId: string, target: TStateName): EngineResult {
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const state = workflow.getState()
    const currentStateName = state.currentStateMachineState
    const registry = this.factory.getRegistry()

    const currentDef = registry[currentStateName]
    if (!currentDef.canTransitionTo.includes(target)) {
      const legalTargets = currentDef.canTransitionTo
      const reason = `Illegal transition ${currentStateName} -> ${target}. Legal targets from ${currentStateName}: [${legalTargets.join(', ') || 'none'}].`
      const procedurePath = buildProcedurePath(this.engineDeps, currentStateName)
      const currentPrefix = getExpectedPrefix(currentStateName, registry)
      return {
        type: 'blocked',
        output: formatIllegalTransitionError(reason, procedurePath, currentPrefix) 
      }
    }

    const guardResult = this.checkTransitionGuard(currentDef, state, currentStateName, target, registry)
    if (guardResult !== undefined) return guardResult

    const targetDef = registry[target]
    const stateBefore = workflow.getState()
    try {
      const stateAfter = targetDef.onEntry
        ? targetDef.onEntry(
          stateBefore,
          this.factory.buildTransitionContext(stateBefore, currentStateName, target, this.workflowDeps),
        )
        : stateBefore
      const transitionEvent = this.factory.buildTransitionEvent
        ? this.factory.buildTransitionEvent(currentStateName, target, stateBefore, stateAfter, this.engineDeps.now())
        : {
          type: 'transitioned',
          at: this.engineDeps.now(),
          from: currentStateName,
          to: target
        }
      workflow.appendEvent(transitionEvent)
    } catch (error: unknown) {
      return this.uncommittedOperationError(error)
    }
    this.persistEvents(sessionId, workflow)
    const persistedPendingEventCount = workflow.getPendingEvents().length

    const afterEntryFailure = this.runAfterEntry(
      sessionId,
      workflow,
      persistedPendingEventCount,
      targetDef,
    )
    if (afterEntryFailure !== undefined) return afterEntryFailure
    try {
      const newState = workflow.getState()
      const title = this.factory.getTransitionTitle?.(newState.currentStateMachineState, newState)
        ?? newState.currentStateMachineState
      const procedure = readProcedure(this.engineDeps, workflow.getState().currentStateMachineState)
      const newPrefix = getExpectedPrefix(newState.currentStateMachineState, registry)
      return {
        type: 'success',
        output: formatTransitionSuccess(title, procedure, newPrefix)
      }
    } catch (error: unknown) {
      return this.committedResponseError(error)
    }
  }
  checkBash(
    sessionId: string,
    toolName: string,
    command: string,
    bashForbidden: BashForbiddenConfig,
  ): EngineResult {
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return checkBashWithPlatformEvents(this.platformOperationContext(sessionId, workflow), toolName, command, bashForbidden)
  }
  checkWrite(
    sessionId: string,
    toolName: string,
    filePath: string,
    isWriteAllowed: (filePath: string, state: TState) => boolean,
  ): EngineResult {
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return checkWriteWithPlatformEvents(this.platformOperationContext(sessionId, workflow), toolName, filePath, isWriteAllowed)
  }
  checkStopping(sessionId: string, action: StoppingAction, tool?: string): EngineResult {
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return checkStopAllowed(this.platformOperationContext(sessionId, workflow), action, tool)
  }
  getState(sessionId: string): EngineResult {
    return serializeWorkflowState(this.getWorkflowState(sessionId))
  }
  getWorkflowState(sessionId: string): TState {
    sessionId = this.resolveSessionId(sessionId)
    this.requireSession(sessionId)
    return this.rehydrateFromEvents(sessionId).getState()
  }
  persistSessionId(sessionId: string): void {
    sessionId = this.resolveSessionId(sessionId)
    this.engineDeps.appendToFile(this.engineDeps.getEnvFilePath(), `export CLAUDE_SESSION_ID='${sessionId}'\n`)
  }
  hasSession(sessionId: string): boolean {
    return this.engineDeps.store.hasSessionStarted(this.resolveSessionId(sessionId))
  }
  hasSessionStarted(sessionId: string): boolean {
    return this.engineDeps.store.hasSessionStarted(this.resolveSessionId(sessionId))
  }
  private requireSession(sessionId: string): void {
    if (!this.engineDeps.store.hasSessionStarted(sessionId)) {
      throw new WorkflowStateError(`No session found for '${sessionId}'. Run init first.`)
    }
  }
  private resolveSessionId(executingSessionId: string): string {
    return this.engineDeps.store.hasSessionStarted(executingSessionId)
      ? executingSessionId
      : this.engineDeps.sessionContext.getMainSessionId()
  }

  private rehydrateFromEvents(sessionId: string): TWorkflow {
    const stored = this.engineDeps.store.readEvents(sessionId)
    const state = reduceWorkflowStateFromStoredEvents(this.factory, stored)
    return this.factory.buildWorkflow(state, this.workflowDeps)
  }

  private persistEvents(sessionId: string, workflow: TWorkflow, pendingFrom = 0): void {
    const pending = workflow.getPendingEvents().slice(pendingFrom)
    if (pending.length === 0) return
    const preAppendState = reduceWorkflowStateFromStoredEvents(this.factory, this.engineDeps.store.readEvents(sessionId))
    this.engineDeps.store.appendEvents(sessionId, this.wrapEvents(pending, preAppendState))
  }
  private wrapEvents(events: readonly BaseEvent[], startState: TState): readonly StoredEvent[] {
    const { stored } = events.reduce<{
      state: TState;
      stored: readonly StoredEvent[];
    }>(
      (accumulator, event) => ({
        state: this.factory.fold(accumulator.state, event),
        stored: [...accumulator.stored, {
          envelope: {
            type: event.type,
            at: event.at,
            state: accumulator.state.currentStateMachineState,
          },
          payload: toPayload(event),
        }],
      }),
      {
        state: startState,
        stored: [],
      },
    )
    return stored
  }

  private platformOperationContext(sessionId: string, workflow: TWorkflow) {
    return {
      workflow,
      engineDeps: this.engineDeps,
      factory: this.factory,
      persistPlatformEvent: (event: unknown) => this.persistPlatformEvent(sessionId, workflow.getState(), event),
    }
  }

  private persistPlatformEvent(sessionId: string, state: TState, event: unknown): void {
    const platformEvent = engineEventSchema.parse(event)
    this.engineDeps.store.appendEvents(sessionId, [{
      envelope: {
        type: platformEvent.type,
        at: platformEvent.at,
        state: state.currentStateMachineState,
      },
      payload: toPayload(platformEvent),
    }])
  }

  private uncommittedOperationError(error: unknown): EngineResult {
    return {
      type: 'error',
      output: `Workflow operation failed before persistence: ${this.errorMessage(error)}`,
      persistence: 'not-attempted',
    }
  }

  private committedResponseError(error: unknown): EngineResult {
    return {
      type: 'error',
      output: `Workflow operation committed, but its response could not be completed: ${this.errorMessage(error)}`,
      persistence: 'committed',
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private runOperationCallback(callback: () => PreconditionResult): PreconditionResult | EngineResult {
    try {
      return callback()
    } catch (error: unknown) {
      return this.uncommittedOperationError(error)
    }
  }

  private runAfterEntry(sessionId: string, workflow: TWorkflow, pendingFrom: number, targetDef: ReturnType<WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>['getRegistry']>[TStateName]): EngineResult | undefined {
    const failure = (() => {
      try {
        targetDef.afterEntry?.(); return undefined
      } catch (error: unknown) { return this.committedResponseError(error) }
    })()
    try {
      this.persistEvents(sessionId, workflow, pendingFrom)
    } catch (error: unknown) { return this.committedResponseError(error) }
    return failure
  }

  private checkTransitionGuard(
    currentDef: ReturnType<WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>['getRegistry']>[TStateName],
    state: TState,
    currentStateName: TStateName,
    target: TStateName,
    registry: ReturnType<WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation, TTransitionContext>['getRegistry']>,
  ): EngineResult | undefined {
    if (target === 'BLOCKED' || currentDef.transitionGuard === undefined) return undefined
    const guardResult = this.runOperationCallback(() => currentDef.transitionGuard?.(
      this.factory.buildTransitionContext(state, currentStateName, target, this.workflowDeps),
    ) ?? { pass: true })
    if ('type' in guardResult) return guardResult
    if (guardResult.pass) return undefined
    const procedurePath = buildProcedurePath(this.engineDeps, currentStateName)
    const currentPrefix = getExpectedPrefix(currentStateName, registry)
    return {
      type: 'blocked',
      output: formatTransitionError(target, guardResult.reason, procedurePath, currentPrefix),
    }
  }
}
