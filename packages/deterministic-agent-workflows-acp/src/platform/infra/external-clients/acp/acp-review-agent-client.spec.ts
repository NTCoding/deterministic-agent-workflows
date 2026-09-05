import {
  dirname, join 
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  describe, expect, it 
} from 'vitest'
import { createAcpReviewAgentClient } from './acp-review-agent-client'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const fixture = join(packageRoot, 'src', '__fixtures__', 'fake-acp-agent.mjs')
const request = {
  bundleId: 'bundle-1',
  reviewType: 'custom-review',
  repository: 'owner/repository',
  workingDirectory: packageRoot,
  pullRequestNumber: 42,
  baseRevision: 'base',
  headRevision: 'head',
  prompt: 'Review this change.',
}

function client(mode: string, options: {
  timeoutMs?: number;
  cancellationGraceMs?: number 
} = {}) {
  return createAcpReviewAgentClient({
    command: process.execPath,
    args: [fixture],
    environment: { FAKE_ACP_MODE: mode },
    timeoutMs: options.timeoutMs ?? 2_000,
    cancellationGraceMs: options.cancellationGraceMs ?? 50,
  })
}

describe('createAcpReviewAgentClient', () => {
  it('negotiates ACP, starts a session, prompts, and validates review output', async () => {
    const run = await client('pass').start(request)

    await expect(run.completion).resolves.toStrictEqual({
      verdict: 'PASS',
      summary: request.prompt,
      findings: [],
    })
  })

  it('rejects GitHub credentials in the reviewer environment', async () => {
    const reviewClient = createAcpReviewAgentClient({
      command: process.execPath,
      args: [fixture],
      environment: { GITHUB_TOKEN: 'secret' },
      timeoutMs: 2_000,
      cancellationGraceMs: 50,
    })

    await expect(reviewClient.start(request)).rejects.toThrow(
      'must not include credential GITHUB_TOKEN',
    )
  })

  it('rejects unsupported protocol versions', async () => {
    await expect(client('wrong-version').start(request)).rejects.toThrow(
      'Unsupported ACP protocol version',
    )
  })

  it('rejects malformed review output', async () => {
    const run = await client('invalid-json').start(request)

    await expect(run.completion).rejects.toThrow('Unexpected token')
  })

  it('requires advertised session loading support', async () => {
    await expect(client('pass').load(request, 'stored-session')).rejects.toThrow(
      'does not advertise session/load support',
    )
  })

  it('loads an advertised existing session', async () => {
    const run = await client('load').load(request, 'stored-session')

    expect(run.providerSessionId).toBe('stored-session')
    await expect(run.completion).resolves.toMatchObject({ verdict: 'PASS' })
  })

  it('cancels a cooperative prompt', async () => {
    const run = await client('slow').start(request)
    const completion = expect(run.completion).rejects.toThrow('ACP connection closed')

    await run.cancel()
    await completion
  })

  it('forces termination when cancellation is ignored', async () => {
    const run = await client('ignore-cancel', { cancellationGraceMs: 10 }).start(request)
    const completion = expect(run.completion).rejects.toThrow('ACP connection closed')

    await expect(run.cancel()).resolves.toBeUndefined()
    await completion
  })

  it('times out and terminates a stalled prompt', async () => {
    const run = await client('ignore-cancel', {
      timeoutMs: 10,
      cancellationGraceMs: 10,
    }).start(request)

    await expect(run.completion).rejects.toThrow('timed out')
  })
})
