import type { ZodType } from 'zod'
import type { BaseEvent } from './base-event'
import type { PreconditionResult } from './precondition-result'
import type { TranscriptReader } from '../infra/external-clients/transcript/transcript-reader'
import type { BaseWorkflowState } from './workflow-state'
import type {
  TransitionContext, WorkflowRegistry 
} from './workflow-registry'

/** @riviere-role value-object */
export type EngineResult =
  | {
    readonly type: 'success';
    readonly output: string 
  }
  | {
    readonly type: 'blocked';
    readonly output: string 
  }
  | {
    readonly type: 'error';
    readonly output: string 
  }

/** @riviere-role value-object */
export interface RehydratableWorkflow<TState extends BaseWorkflowState> {
  getState(): TState
  appendEvent(event: BaseEvent): void
  getPendingEvents(): readonly BaseEvent[]
  startSession(transcriptPath: string, repository: string | undefined): void
  getTranscriptPath(): string
  registerAgent(agentType: string, agentId: string): PreconditionResult
  handleTeammateIdle(agentName: string): PreconditionResult
  writeJournal?(agentName: string, content: string): PreconditionResult
}

/** @riviere-role value-object */
export interface WorkflowDefinition<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
> {
  fold(state: TState, event: BaseEvent): TState
  buildWorkflow(state: TState, deps: TDeps): TWorkflow
  stateSchema: ZodType<TStateName>
  initialState(): TState
  getRegistry(): WorkflowRegistry<TState, TStateName, TOperation>
  buildTransitionContext(state: TState, from: TStateName, to: TStateName, deps: TDeps): TransitionContext<TState, TStateName>
  getOperationBody?(op: string, state: TState): string
  getTransitionTitle?(to: TStateName, state: TState): string
  buildTransitionEvent?(from: TStateName, to: TStateName, stateBefore: TState, stateAfter: TState, now: string): BaseEvent
}

/** @riviere-role value-object */
export interface WorkflowEventStore {
  readEvents(sessionId: string): readonly BaseEvent[]
  appendEvents(sessionId: string, events: readonly BaseEvent[]): void
  sessionExists(sessionId: string): boolean
  hasSessionStarted(sessionId: string): boolean
}

/** @riviere-role value-object */
export type WorkflowEngineDeps = {
  readonly store: WorkflowEventStore
  readonly getPluginRoot: () => string
  readonly getEnvFilePath: () => string
  readonly getRepositoryName?: () => string | undefined
  readonly readFile: (path: string) => string
  readonly appendToFile: (filePath: string, content: string) => void
  readonly now: () => string
  readonly transcriptReader: TranscriptReader
}
