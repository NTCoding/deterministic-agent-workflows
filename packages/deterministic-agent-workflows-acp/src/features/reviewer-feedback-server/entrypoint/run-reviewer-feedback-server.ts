import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  reviewerFeedbackServerSpecSchema,
  ReviewerFeedbackError,
} from '../../../platform/domain/reviewer-feedback/reviewer-feedback-types'
import { createReviewerFeedbackService } from '../../../platform/domain/reviewer-feedback/reviewer-feedback-operations'
import { createGithubApiClient } from '../../../platform/infra/external-clients/github/github-api-client'
import { startReviewerFeedbackMcpServer } from '../../../platform/infra/external-clients/mcp/reviewer-feedback-mcp-server'

export const feedbackGithubTokenEnv = 'DETERMINISTIC_AGENT_WORKFLOW_FEEDBACK_GITHUB_TOKEN'

interface ReviewerFeedbackServerIo {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
}

function configPathFromArguments(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--config')
  if (flagIndex < 0 || flagIndex + 1 >= argv.length) {
    throw new ReviewerFeedbackError('validation', 'Usage: reviewer-feedback-server --config <config.json>')
  }
  const value = argv[flagIndex + 1]
  if (value.trim().length === 0) {
    throw new ReviewerFeedbackError('validation', 'Usage: reviewer-feedback-server --config <config.json>')
  }
  return value
}

/** @riviere-role cli-entrypoint */
export function runReviewerFeedbackServer(io: ReviewerFeedbackServerIo): { readonly stop: () => void } {
  const configPath = configPathFromArguments(io.argv)
  const rawSpec: unknown = JSON.parse(readFileSync(configPath, 'utf8'))
  const spec = reviewerFeedbackServerSpecSchema.parse(rawSpec)
  const token = io.env[feedbackGithubTokenEnv]
  if (token === undefined || token.trim().length === 0) {
    throw new ReviewerFeedbackError(
      'auth',
      `Environment variable ${feedbackGithubTokenEnv} must hold the GitHub token for the feedback server.`,
    )
  }
  const store = createStore(spec.databasePath)
  const github = createGithubApiClient({
    token,
    repository: spec.repository,
    pullRequestNumber: spec.pullRequestNumber,
    ...(spec.restApiBaseUrl === undefined ? {} : { restApiBaseUrl: spec.restApiBaseUrl }),
    ...(spec.graphqlApiBaseUrl === undefined ? {} : { graphqlApiBaseUrl: spec.graphqlApiBaseUrl }),
  })
  const service = createReviewerFeedbackService({
    spec,
    github,
    reviewJobStore: store,
    feedbackStore: store,
    now: () => new Date().toISOString(),
  })
  return startReviewerFeedbackMcpServer({
    service,
    input: io.input,
    output: io.output,
  })
}

interface ReviewerFeedbackServerConfigFileInput {
  readonly spec: unknown
  readonly configPath: string
}

/** @riviere-role cli-entrypoint */
export function writeReviewerFeedbackServerConfigFile(input: ReviewerFeedbackServerConfigFileInput): string {
  const validated = reviewerFeedbackServerSpecSchema.parse(input.spec)
  mkdirSync(dirname(input.configPath), { recursive: true })
  writeFileSync(input.configPath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  return input.configPath
}
