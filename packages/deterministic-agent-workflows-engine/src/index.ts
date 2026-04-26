export type { BaseWorkflowState } from './platform/domain/workflow-state'
export { WorkflowStateError } from './platform/domain/workflow-state'

export type { BaseEvent } from './platform/domain/base-event'
export { baseEventSchema } from './platform/domain/base-event'

export type {
  EventEnvelope,
  StoredEvent,
} from './platform/domain/stored-event'
export {
  flattenStoredEvent,
  stripEnvelopeKeys,
  toPayload,
} from './platform/domain/stored-event'

export {
  reflectionCategorySchema,
  reflectionConfidenceSchema,
  reflectionEvidenceSchema,
  reflectionFindingSchema,
  reflectionPayloadSchema,
  recordReflectionInputSchema,
  storedReflectionSchema,
} from './platform/domain/reflection-types'
export type {
  ReflectionCategory,
  ReflectionEvidence,
  ReflectionFinding,
  ReflectionPayload,
  RecordReflectionInput,
  StoredReflection,
} from './platform/domain/reflection-types'

export {
  reviewTypeSchema,
  reviewVerdictSchema,
  reviewFindingSeveritySchema,
  reviewFindingStatusSchema,
  reviewFindingSchema,
  reviewPayloadSchema,
  recordReviewInputSchema,
  storedReviewSchema,
  listedReviewSchema,
  reviewFiltersSchema,
} from './platform/domain/review-types'
export type {
  ReviewType,
  ReviewVerdict,
  ReviewFindingSeverity,
  ReviewFindingStatus,
  ReviewFinding,
  ReviewPayload,
  RecordReviewInput,
  StoredReview,
  ListedReview,
  ReviewFilters,
} from './platform/domain/review-types'

export { engineEventSchema } from './platform/domain/engine-events'
export type {
  EngineEvent,
  SessionStartedEvent,
  TransitionedEvent,
  AgentRegisteredEvent,
  AgentShutDownEvent,
  JournalEntryEvent,
  WriteCheckedEvent,
  BashCheckedEvent,
  PluginReadCheckedEvent,
  IdleCheckedEvent,
  IdentityVerifiedEvent,
  ContextRequestedEvent,
  ReviewRecordedEvent,
} from './platform/domain/engine-events'
export { isPlatformOwnedEventExcludedFromWorkflowState } from './platform/domain/engine-events'

export { reduceWorkflowStateFromStoredEvents } from './platform/domain/workflow-state-reducer'

export { repositoryMetadataEventSchema } from './platform/domain/repository-tracking-events'
export type {
  DomainMetadataEvent,
  IssueRecordedEvent,
  BranchRecordedEvent,
  PrRecordedEvent,
} from './platform/domain/repository-tracking-events'

export { checkBashCommand } from './platform/domain/bash-enforcement'

export type { PreconditionResult } from './platform/domain/precondition-result'
export {
  pass, fail 
} from './platform/domain/precondition-result'

export type {
  GitInfo,
  TransitionContext,
  BashForbiddenConfig,
  WorkflowStateDefinition,
  WorkflowRegistry,
} from './platform/domain/workflow-registry'

export { WorkflowEngine } from './platform/domain/workflow-engine'
export type {
  EngineResult,
  RehydratableWorkflow,
  WorkflowDefinition,
  WorkflowEventStore,
  WorkflowEngineDeps,
} from './platform/domain/workflow-engine-types'

export type {
  TranscriptMessage, TranscriptReader 
} from './platform/infra/external-clients/transcript/transcript-reader'
export type { IdentityCheckResult } from './platform/domain/identity-verification'
export { checkIdentity } from './platform/domain/identity-verification'
export {
  workflowSpec,
  WorkflowSpecError,
} from './platform/domain/testing/workflow-spec'
export type {
  GivenPhase,
  OperationResult,
  SpecConfig,
  ThrowResult,
  WorkflowSpecification,
} from './platform/domain/testing/workflow-spec'
