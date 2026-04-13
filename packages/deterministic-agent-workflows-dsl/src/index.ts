export {
  fail,
  pass,
} from './shell/result'
export type { PreconditionResult } from './shell/result'

export type {
  BashForbiddenConfig,
  GitInfo,
  TransitionContext,
  WorkflowRegistry,
  WorkflowStateDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'

export { checkBashCommand } from './shell/bash-enforcement'
export {
  checkOperationGate,
  defineRecordingOps,
} from './platform/domain/recording-ops'
export type {
  RecordingOpDefinition,
  RecordingOpResult,
  RecordingOpsFactory,
} from './platform/domain/recording-ops'
