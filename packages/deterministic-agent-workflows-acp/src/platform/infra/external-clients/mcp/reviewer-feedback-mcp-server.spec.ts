import { PassThrough } from 'node:stream'
import { z } from 'zod'
import {
  describe,
  expect,
  it,
} from 'vitest'
import type { ReviewerFeedbackService } from '../../../domain/reviewer-feedback/reviewer-feedback-operations'
import { startReviewerFeedbackMcpServer } from './reviewer-feedback-mcp-server'

const jsonRpcResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).optional(),
}).passthrough()

const toolResultSchema = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    content: z.array(z.object({ text: z.string() })),
  }),
})

const initializeResultSchema = z.object({
  result: z.object({
    protocolVersion: z.string(),
    capabilities: z.record(z.unknown()),
    serverInfo: z.object({
      name: z.string(),
      version: z.string().optional(),
    }),
  }),
})

const toolsListResultSchema = z.object({
  result: z.object({
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.record(z.unknown()),
    })),
  }),
})

function createStubService(overrides: Partial<ReviewerFeedbackService> = {}): ReviewerFeedbackService {
  return {
    readReviewContext: async () => ({
      repository: 'example-repo/example-project',
      pullRequestNumber: 42,
      bundleId: 'bundle-1',
      workflowSessionId: 'session-1',
      reviewType: 'architecture-review',
      agentPrefix: '[architecture-review]',
      sourceState: 'REVIEWING',
      expectedHeadRevision: 'head-sha',
      currentHeadRevision: 'head-sha',
      headStatus: 'current',
      stateInstructions: 'Instructions.',
      reviewInstructions: 'Review.',
      changedFiles: [],
      threadResolutionPolicy: 'owned-threads',
      submission: undefined,
      threadOwnership: [],
      openThreads: [],
    }),
    submitReview: async () => ({
      status: 'submitted',
      reviewId: 101,
      commentIds: [1001],
    }),
    replyToThread: async () => ({
      status: 'replied',
      threadId: 'PRRT_1',
      replyCommentId: 1002,
    }),
    recordCompletion: async () => ({
      status: 'recorded',
      reviewId: 7,
      agentStatus: 'completed',
    }),
    resolveThread: async () => ({
      status: 'resolved',
      threadId: 'PRRT_1',
    }),
    ...overrides,
  }
}

function createServerHarness(service: ReviewerFeedbackService): {
  readonly send: (line: string) => void
  readonly nextResponse: () => Promise<string>
  readonly stop: () => void
} {
  const input = new PassThrough()
  const output = new PassThrough()
  startReviewerFeedbackMcpServer({
    service,
    input,
    output,
  })
  output.setEncoding('utf8')
  const pending: string[] = []
  const waiting: ((line: string) => void)[] = []
  output.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.trim().length === 0) continue
      const waiter = waiting.shift()
      if (waiter === undefined) {
        pending.push(line)
        continue
      }
      waiter(line)
    }
  })
  return {
    send: (line) => input.write(`${line}\n`),
    nextResponse: () => new Promise((resolve) => {
      const queued = pending.shift()
      if (queued === undefined) {
        waiting.push(resolve)
        return
      }
      resolve(queued)
    }),
    stop: () => {
      input.destroy()
      output.destroy()
    },
  }
}

describe('reviewer feedback MCP server', () => {
  it('negotiates the protocol version on initialize', async () => {
    const harness = createServerHarness(createStubService())
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'fixture' },
      },
    }))
    const response = initializeResultSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(response.result.protocolVersion).toBe('2024-11-05')
    expect(response.result.capabilities).toStrictEqual({ tools: {} })
    harness.stop()
  })

  it('lists exactly the five bounded operations', async () => {
    const harness = createServerHarness(createStubService())
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }))
    const response = toolsListResultSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(response.result.tools.map((tool) => tool.name)).toStrictEqual([
      'read-review-context',
      'submit-review',
      'reply-to-thread',
      'record-completion',
      'resolve-thread',
    ])
    harness.stop()
  })

  it('dispatches tools/call to the service and returns structured content', async () => {
    const harness = createServerHarness(createStubService())
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'submit-review',
        arguments: {
          body: 'Looks good.',
          comments: [],
        },
      },
    }))
    const response = toolResultSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(response.result.isError).toBe(false)
    expect(JSON.parse(response.result.content[0]?.text ?? '{}')).toStrictEqual({
      status: 'submitted',
      reviewId: 101,
      commentIds: [1001],
    })
    harness.stop()
  })

  it('rejects invalid tool arguments as a tool error instead of crashing', async () => {
    const harness = createServerHarness(createStubService())
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'submit-review',
        arguments: { body: '' },
      },
    }))
    const response = toolResultSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(response.result.isError).toBe(true)
    const errorPayload = z.object({ kind: z.string() }).parse(JSON.parse(response.result.content[0]?.text ?? '{}'))
    expect(errorPayload.kind).toBe('validation')
    harness.stop()
  })

  it('answers unknown methods with a JSON-RPC method error', async () => {
    const harness = createServerHarness(createStubService())
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/list',
    }))
    const response = jsonRpcResponseSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(response.error?.code).toBe(-32601)
    expect(response.id).toBe(5)
    harness.stop()
  })

  it('answers malformed lines with a parse error and keeps serving', async () => {
    const harness = createServerHarness(createStubService())
    harness.send('{not json')
    const parseError = jsonRpcResponseSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(parseError.error?.code).toBe(-32700)
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 6,
      method: 'ping',
    }))
    const ping = jsonRpcResponseSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(ping.id).toBe(6)
    harness.stop()
  })

  it('stays silent for notifications and rejects oversized messages', async () => {
    const harness = createServerHarness(createStubService())
    harness.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }))
    harness.send(`"x${'y'.repeat(1_048_576)}"`)
    const oversized = jsonRpcResponseSchema.parse(JSON.parse(await harness.nextResponse()))
    expect(oversized.error?.code).toBe(-32700)
    harness.stop()
  })
})
