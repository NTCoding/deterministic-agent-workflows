export type { BaseWorkflowState } from './platform/domain/workflow-state'
export { WorkflowStateError } from './platform/domain/workflow-state'

export type { BaseEvent } from './platform/domain/base-event'
export { baseEventSchema } from './platform/domain/base-event'

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
} from './platform/domain/engine-events'

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
