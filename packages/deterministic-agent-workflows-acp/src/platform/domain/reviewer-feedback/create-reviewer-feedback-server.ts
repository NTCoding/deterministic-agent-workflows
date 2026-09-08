import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { McpServer } from '@agentclientprotocol/sdk'
import type { ReviewerFeedbackServerSpec } from './reviewer-feedback-types'
import {
  writeReviewerFeedbackServerConfigFile,
  feedbackGithubTokenEnv,
} from '../../../features/reviewer-feedback-server/entrypoint/run-reviewer-feedback-server'

/** @riviere-role value-object */
export interface ReviewerFeedbackServerLaunch {
  readonly spec: ReviewerFeedbackServerSpec
  readonly githubToken: string
}

/** @riviere-role value-object */
export interface ReviewerFeedbackServerOptions {
  readonly serverScriptPath?: string
  readonly serverCommand?: string
  readonly configDirectory?: string
}

function defaultServerScriptPath(): string {
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve('@nt-ai-lab/deterministic-agent-workflow-acp/package.json')
  const packageRoot = packageJsonPath.replace(/package\.json$/u, '')
  return join(packageRoot, 'dist', 'bin', 'reviewer-feedback-server.js')
}

function configFilePath(options: ReviewerFeedbackServerOptions, reviewType: string): string {
  const directory = options.configDirectory ?? mkdtempSync(join(tmpdir(), 'daw-reviewer-feedback-'))
  return join(directory, `${reviewType}.feedback-server.json`)
}

/** @riviere-role domain-service */
export function createReviewerFeedbackMcpServer(
  launch: ReviewerFeedbackServerLaunch,
  options: ReviewerFeedbackServerOptions = {},
): McpServer {
  const serverScriptPath = options.serverScriptPath ?? defaultServerScriptPath()
  const configPath = writeReviewerFeedbackServerConfigFile({
    spec: launch.spec,
    configPath: configFilePath(options, launch.spec.reviewType),
  })
  return {
    name: `reviewer-feedback-${launch.spec.reviewType}`,
    command: options.serverCommand ?? process.execPath,
    args: [serverScriptPath, '--config', configPath],
    env: [
      {
        name: feedbackGithubTokenEnv,
        value: launch.githubToken,
      },
    ],
  }
}
