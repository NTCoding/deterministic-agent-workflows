import type {
  BaseWorkflowState,
  RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createWorkflowCli } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type { ClaudeCodeWorkflowCliConfig } from '../../../platform/domain/claude-code-workflow-cli-types'
import { ClaudeCodeTranscriptReader } from '../../../platform/infra/external-clients/claude-code/claude-code-transcript-reader'

/** @riviere-role cli-entrypoint */
export function createClaudeCodeWorkflowCli<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState,
  TDeps,
>(config: ClaudeCodeWorkflowCliConfig<TWorkflow, TState, TDeps>): void {
  createWorkflowCli({
    ...config,
    transcriptReader: new ClaudeCodeTranscriptReader(),
  })
}
