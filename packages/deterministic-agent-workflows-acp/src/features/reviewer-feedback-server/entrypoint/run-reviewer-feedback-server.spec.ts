import {
  mkdtempSync, readFileSync, rmSync, statSync, writeFileSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  afterAll, afterEach, beforeAll, describe, expect, it 
} from 'vitest'
import { z } from 'zod'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  feedbackGithubTokenEnv,
  runReviewerFeedbackServer,
  writeReviewerFeedbackServerConfigFile,
} from './run-reviewer-feedback-server'
import {
  startFixtureGithubServer,
  type FixtureGithubServer,
} from '../../../platform/domain/reviewer-feedback/__fixtures__/reviewer-feedback-github-fixture'

const workspaceHolder: {
  fixture?: FixtureGithubServer
  directory?: string
} = {}

beforeAll(async () => {
  workspaceHolder.fixture = await startFixtureGithubServer({
    headRevision: 'head-sha',
    diff: '',
  })
})

afterAll(async () => {
  await workspaceHolder.fixture?.close()
})

function requireFixture(): FixtureGithubServer {
  if (workspaceHolder.fixture === undefined) throw new TypeError('The fixture GitHub server is not started.')
  return workspaceHolder.fixture
}

afterEach(() => {
  workspaceHolder.fixture?.reset()
  const workspace = workspaceHolder.directory
  if (workspace === undefined) return
  rmSync(workspace, {
    recursive: true,
    force: true,
  })
})

class ResponseReader {
  private readonly pending: string[] = []
  private readonly waiting: ((line: string) => void)[] = []

  constructor(output: PassThrough) {
    output.setEncoding('utf8')
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim().length === 0) continue
        const waiter = this.waiting.shift()
        if (waiter === undefined) {
          this.pending.push(line)
          continue
        }
        waiter(line)
      }
    })
  }

  next(): Promise<string> {
    const queued = this.pending.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.waiting.push(resolve)
    })
  }
}

const jsonRpcResultSchema = z.object({
  result: z.object({
    serverInfo: z.object({ name: z.string() }).optional(),
    content: z.array(z.object({ text: z.string() })).optional(),
  }),
})

const toolTextSchema = z.object({ stateInstructions: z.string() })

function createWorkspace(): string {
  workspaceHolder.directory = mkdtempSync(join(tmpdir(), 'daw-reviewer-feedback-entry-'))
  return workspaceHolder.directory
}

function seedWorkflowDatabase(databasePath: string): void {
  const store = createStore(databasePath)
  store.claimReviewBundle({
    bundleId: 'bundle-1',
    sessionId: 'session-1',
    repository: 'example-repo/example-project',
    workingDirectory: workspaceHolder.directory ?? tmpdir(),
    pullRequestNumber: 42,
    baseRevision: 'base-sha',
    headRevision: 'head-sha',
    changedFiles: ['src/engine.ts'],
    stateInstructions: 'State instructions for REVIEWING.',
    reviews: [{
      reviewType: 'architecture-review',
      instructions: 'Review.',
      version: '1' 
    }],
  }, '2026-01-01T00:00:00.000Z')
  store.markReviewBundleRunning('bundle-1', '2026-01-01T00:00:01.000Z')
  store.markReviewAgentRunning(
    'bundle-1',
    'architecture-review',
    'provider-session-1',
    'provider-run-1',
    '2026-01-01T00:00:02.000Z',
  )
}

function writeConfigFile(spec: Record<string, unknown>): string {
  const directory = createWorkspace()
  const configPath = join(directory, 'architecture-review.feedback-server.json')
  writeFileSync(configPath, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600 })
  return configPath
}

function buildValidSpec(): string {
  const directory = createWorkspace()
  const databasePath = join(directory, 'workflow.db')
  seedWorkflowDatabase(databasePath)
  const spec: Record<string, unknown> = {
    repository: 'example-repo/example-project',
    pullRequestNumber: 42,
    bundleId: 'bundle-1',
    workflowSessionId: 'session-1',
    reviewType: 'architecture-review',
    sourceState: 'REVIEWING',
    expectedHeadRevision: 'head-sha',
    threadResolution: 'owned-threads',
    bounds: {},
    databasePath,
    restApiBaseUrl: requireFixture().restBaseUrl,
    graphqlApiBaseUrl: requireFixture().graphqlBaseUrl,
  }
  return writeReviewerFeedbackServerConfigFile({
    spec,
    configPath: join(directory, 'server.json') 
  })
}

describe('reviewer feedback server entrypoint', () => {
  it('fails closed when the config argument is missing', () => {
    createWorkspace()
    expect(() => runReviewerFeedbackServer({
      argv: [],
      env: { [feedbackGithubTokenEnv]: 'fixture-token' },
      input: new PassThrough(),
      output: new PassThrough(),
    })).toThrow('--config')
  })

  it('fails closed when the GitHub token is absent from the environment', () => {
    const configPath = buildValidSpec()
    expect(() => runReviewerFeedbackServer({
      argv: ['--config', configPath],
      env: {},
      input: new PassThrough(),
      output: new PassThrough(),
    })).toThrow(feedbackGithubTokenEnv)
  })

  it('fails closed when the config file carries unexpected fields such as a token', () => {
    const configPath = buildValidSpec()
    const tampered = {
      ...JSON.parse(readFileSync(configPath, 'utf8')),
      githubToken: 'leaked-token' 
    }
    writeFileSync(configPath, JSON.stringify(tampered), { mode: 0o600 })
    expect(() => runReviewerFeedbackServer({
      argv: ['--config', configPath],
      env: { [feedbackGithubTokenEnv]: 'fixture-token' },
      input: new PassThrough(),
      output: new PassThrough(),
    })).toThrow('Unrecognized key')
  })

  it('writes platform-built config files with owner-only permissions', () => {
    const directory = createWorkspace()
    const configPath = writeReviewerFeedbackServerConfigFile({
      spec: {
        repository: 'example-repo/example-project',
        pullRequestNumber: 42,
        bundleId: 'bundle-1',
        workflowSessionId: 'session-1',
        reviewType: 'architecture-review',
        sourceState: 'REVIEWING',
        expectedHeadRevision: 'head-sha',
        threadResolution: 'owned-threads',
        bounds: {},
        databasePath: join(directory, 'workflow.db'),
      },
      configPath: join(directory, 'server.json'),
    })
    expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it('serves review context end to end through the stdio server', async () => {
    const configPath = buildValidSpec()
    const input = new PassThrough()
    const output = new PassThrough()
    runReviewerFeedbackServer({
      argv: ['--config', configPath],
      env: { [feedbackGithubTokenEnv]: 'fixture-token' },
      input,
      output,
    })
    const reader = new ResponseReader(output)
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'fixture' } 
      },
    })}\n`)
    const initialization = jsonRpcResultSchema.parse(JSON.parse(await reader.next()))
    const serverName = initialization.result.serverInfo?.name
    expect(serverName).toBe('deterministic-agent-workflow-reviewer-feedback')
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'read-review-context',
        arguments: {} 
      },
    })}\n`)
    const context = jsonRpcResultSchema.parse(JSON.parse(await reader.next()))
    const toolText = context.result.content?.[0]?.text
    const payload = toolTextSchema.parse(JSON.parse(toolText ?? '{}'))
    expect(payload.stateInstructions).toContain('REVIEWING')
  })
})
