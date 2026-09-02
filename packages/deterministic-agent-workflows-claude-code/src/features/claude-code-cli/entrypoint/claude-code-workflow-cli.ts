import type {
  BaseWorkflowState,
  RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createWorkflowCli } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type { ClaudeCodeWorkflowCliConfig } from '../../../platform/domain/claude-code-workflow-cli-types'
import { ClaudeCodeSessionContextError } from '../../../platform/domain/claude-code-session-context-error'
import { ClaudeCodeTranscriptReader } from '../../../platform/infra/external-clients/claude-code/claude-code-transcript-reader'

const CLAUDE_CODE_QUESTION_TOOL = 'AskUserQuestion'

/** @riviere-role cli-entrypoint */
export function createClaudeCodeWorkflowCli<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState,
  TDeps,
>(config: ClaudeCodeWorkflowCliConfig<TWorkflow, TState, TDeps>): void {
  const getMainSessionId = (): string => {
    const sessionId = config.processDeps.getEnv('CLAUDE_SESSION_ID')
    if (sessionId === undefined || sessionId === '') {
      throw new ClaudeCodeSessionContextError('Missing required environment variable: CLAUDE_SESSION_ID')
    }
    return sessionId
  }
  createWorkflowCli({
    ...config,
    questionToolName: CLAUDE_CODE_QUESTION_TOOL,
    transcriptReader: new ClaudeCodeTranscriptReader(),
  }, { getMainSessionId })
}
