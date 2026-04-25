import type { ZodType } from 'zod'
import type { BaseEvent } from './base-event'
import type {
  RecordReflectionInput,
  StoredReflection,
} from './reflection-types'
import type {
  ListedReview,
  RecordReviewInput,
  ReviewFilters,
  StoredReview,
} from './review-types'
import type { StoredEvent } from './stored-event'
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
  readEvents(sessionId: string): readonly StoredEvent[]
  appendEvents(sessionId: string, events: readonly StoredEvent[]): void
  sessionExists(sessionId: string): boolean
  hasSessionStarted(sessionId: string): boolean
  recordReflection(sessionId: string, createdAt: string, input: RecordReflectionInput): StoredReflection
  listReflections(sessionId: string): readonly StoredReflection[]
  recordReview(sessionId: string, createdAt: string, input: RecordReviewInput): StoredReview
  recordReviewWithEvent(sessionId: string, createdAt: string, input: RecordReviewInput, eventState: string): StoredReview
  listSessionReviews(sessionId: string): readonly StoredReview[]
  listReviews(filters: ReviewFilters): readonly ListedReview[]
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
