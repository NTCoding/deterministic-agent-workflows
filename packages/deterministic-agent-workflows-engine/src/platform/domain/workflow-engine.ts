import {
  checkBashWithPlatformEvents,
  checkMessageWithPlatformEvents,
  checkWriteWithPlatformEvents,
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
import type { BashForbiddenConfig } from './workflow-registry'
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
> {
  constructor(
    private readonly factory: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>,
    private readonly engineDeps: WorkflowEngineDeps,
    private readonly workflowDeps: TDeps,
  ) {}

  startSession(sessionId: string, transcriptPath: string, repository: string): EngineResult {
    const validSessionId = requireNonEmptyString(sessionId, 'sessionId')
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
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const registry = this.factory.getRegistry()

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

  writeJournal(sessionId: string, agentName: string, content: string): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return writeJournalWithPlatformEvents(this.platformOperationContext(sessionId, workflow), agentName, content)
  }

  checkMessage(sessionId: string): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return checkMessageWithPlatformEvents(this.platformOperationContext(sessionId, workflow))
  }

  transition(sessionId: string, target: TStateName): EngineResult {
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

    if (target !== 'BLOCKED' && currentDef.transitionGuard) {
      const context = this.factory.buildTransitionContext(state, currentStateName, target, this.workflowDeps)
      const guardResult = currentDef.transitionGuard(context)
      if (!guardResult.pass) {
        const procedurePath = buildProcedurePath(this.engineDeps, currentStateName)
        const currentPrefix = getExpectedPrefix(currentStateName, registry)
        return {
          type: 'blocked',
          output: formatTransitionError(target, guardResult.reason, procedurePath, currentPrefix),
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
    return checkBashWithPlatformEvents(this.platformOperationContext(sessionId, workflow), toolName, command, bashForbidden)
  }

  checkWrite(
    sessionId: string,
    toolName: string,
    filePath: string,
    isWriteAllowed: (filePath: string, state: TState) => boolean,
  ): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    return checkWriteWithPlatformEvents(this.platformOperationContext(sessionId, workflow), toolName, filePath, isWriteAllowed)
  }

  getState(sessionId: string): EngineResult {
    this.requireSession(sessionId)
    return serializeWorkflowState(this.rehydrateFromEvents(sessionId).getState())
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
    const stored = this.engineDeps.store.readEvents(sessionId)
    const state = reduceWorkflowStateFromStoredEvents(this.factory, stored)
    return this.factory.buildWorkflow(state, this.workflowDeps)
  }

  private persistEvents(sessionId: string, workflow: TWorkflow): void {
    const pending = workflow.getPendingEvents()
    if (pending.length === 0) return
    const preAppendState = this.rehydrateFromEvents(sessionId).getState()
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
}
