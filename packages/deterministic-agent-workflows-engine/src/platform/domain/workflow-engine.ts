import { checkIdentity } from './identity-verification'
import {
  checkBashWithPlatformEvents,
  checkWriteWithPlatformEvents,
  writeJournalWithPlatformEvents,
} from './workflow-engine-platform-operations'
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

    this.engineDeps.store.appendEvents(sessionId, this.wrapEvents(pendingEvents, initialState))

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
    const gate = this.applyIdentityGate(sessionId, workflow, op)
    if (gate !== undefined) return gate

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

  transition(sessionId: string, target: TStateName): EngineResult {
    this.requireSession(sessionId)
    const workflow = this.rehydrateFromEvents(sessionId)
    const state = workflow.getState()
    const currentStateName = state.currentStateMachineState
    const registry = this.factory.getRegistry()

    const gate = this.applyIdentityGate(sessionId, workflow, 'transition')
    if (gate !== undefined) return gate

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

  private applyIdentityGate(sessionId: string, workflow: TWorkflow, op: string): EngineResult | undefined {
    const identityResult = this.verifyIdentity(sessionId, workflow)
    if (identityResult === undefined) return undefined
    this.persistEvents(sessionId, workflow)
    const currentPrefix = getExpectedPrefix(workflow.getState().currentStateMachineState, this.factory.getRegistry())
    return {
      type: 'blocked',
      output: formatOperationGateError(op, identityResult, currentPrefix),
    }
  }

  private verifyIdentity(sessionId: string, workflow: TWorkflow): string | undefined {
    const transcriptPath = workflow.getTranscriptPath()
    const state = workflow.getState().currentStateMachineState
    const registry = this.factory.getRegistry()
    const pattern = buildPrefixPattern(registry)
    const messages = this.engineDeps.transcriptReader.readMessages(transcriptPath)
    const identityCheckResult = checkIdentity(messages, pattern)

    this.persistPlatformEvent(sessionId, workflow.getState(), {
      type: 'identity-verified',
      at: this.engineDeps.now(),
      status: identityCheckResult.status,
      transcriptPath,
    })

    if (identityCheckResult.status === 'lost') {
      const currentProcedure = readProcedure(this.engineDeps, state)
      return [
        'Your last message is missing the required state prefix.',
        '',
        `- send a new message starting with: ${getExpectedPrefix(state, registry)}`,
        '- then continue with the current procedure',
        '',
        'Current procedure:',
        '',
        currentProcedure,
      ].join('\n')
    }

    return undefined
  }

  private platformOperationContext(sessionId: string, workflow: TWorkflow) {
    return {
      workflow,
      engineDeps: this.engineDeps,
      factory: this.factory,
      applyIdentityGate: (op: string) => this.applyIdentityGate(sessionId, workflow, op),
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
