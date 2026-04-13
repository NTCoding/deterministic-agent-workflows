import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  TranscriptReader,
  WorkflowEventStore,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { PlatformContext } from './platform-context'
import type {
  RunnerResult,
  WorkflowRunnerConfig,
} from './workflow-runner-types'

/** @riviere-role value-object */
export type ProcessDeps = {
  readonly getEnv: (name: string) => string | undefined
  readonly exit: (code: number) => void
  readonly writeStdout: (s: string) => void
  readonly writeStderr: (s: string) => void
  readonly getArgv: () => readonly string[]
  readonly readFile: (path: string) => string
  readonly appendToFile: (path: string, content: string) => void
  readonly buildStore: (dbPath: string) => WorkflowEventStore
}

/** @riviere-role value-object */
export type WorkflowCliConfig<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState,
  TDeps,
> = WorkflowRunnerConfig<TWorkflow, TState, TDeps> & {
  readonly buildWorkflowDeps: (platform: PlatformContext) => TDeps
  readonly customRouter?: (command: string, args: readonly string[], platform: PlatformContext) => RunnerResult | undefined
  readonly processDeps: ProcessDeps
  readonly transcriptReader: TranscriptReader
}
