import { z } from 'zod'
import type { ReviewerFeedbackService } from '../../../domain/reviewer-feedback/reviewer-feedback-operations'
import {
  ReviewerFeedbackError,
  readReviewContextInputSchema,
  recordCompletionInputSchema,
  replyToThreadInputSchema,
  resolveThreadInputSchema,
  submitReviewInputSchema,
} from '../../../domain/reviewer-feedback/reviewer-feedback-types'

const supportedProtocolVersions: readonly string[] = ['2025-06-18', '2024-11-05']
const latestProtocolVersion = '2025-06-18'
const maxMessageBytes = 1_048_576

const jsonRpcIdSchema = z.union([z.string(), z.number()]).nullable()

const requestEnvelopeSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema,
  method: z.string(),
  params: z.unknown().optional(),
}).strict()

const notificationEnvelopeSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
}).strict()

const initializeParamsSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.unknown()).default({}),
  clientInfo: z.object({
    name: z.string(),
    version: z.string().optional(),
  }).passthrough().default({ name: 'unknown' }),
}).passthrough()

const toolsCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.unknown().default({}),
}).passthrough()

const inputSchemaByOperation = {
  'read-review-context': {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  'submit-review': {
    type: 'object',
    properties: {
      event: {
        type: 'string',
        enum: ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] 
      },
      body: {
        type: 'string',
        minLength: 1 
      },
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              minLength: 1 
            },
            line: {
              type: 'integer',
              minimum: 1 
            },
            side: {
              type: 'string',
              enum: ['LEFT', 'RIGHT'] 
            },
            body: {
              type: 'string',
              minLength: 1 
            },
          },
          required: ['path', 'line', 'body'],
          additionalProperties: false,
        },
      },
    },
    required: ['body'],
    additionalProperties: false,
  },
  'reply-to-thread': {
    type: 'object',
    properties: {
      threadId: {
        type: 'string',
        minLength: 1 
      },
      body: {
        type: 'string',
        minLength: 1 
      },
    },
    required: ['threadId', 'body'],
    additionalProperties: false,
  },
  'record-completion': {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['PASS', 'FAIL'] 
      },
      satisfaction: {
        type: 'string',
        enum: ['satisfied', 'partially-satisfied', 'unsatisfied'] 
      },
      summary: {
        type: 'string',
        minLength: 1 
      },
      findings: {
        type: 'array',
        items: { type: 'object' } 
      },
    },
    required: ['verdict', 'satisfaction'],
    additionalProperties: false,
  },
  'resolve-thread': {
    type: 'object',
    properties: {
      threadId: {
        type: 'string',
        minLength: 1 
      },
    },
    required: ['threadId'],
    additionalProperties: false,
  },
} as const

const toolDefinitions = [
  {
    name: 'read-review-context',
    description:
      'Read the recorded pull request snapshot and the open review threads for this reviewer. ' +
      'Reports whether the pull request head still matches the expected revision.',
  },
  {
    name: 'submit-review',
    description:
      'Submit a normal pull request review with inline comments. Paths and lines are validated against ' +
      'the current diff, stale heads are rejected, and retrying cannot create duplicate reviews.',
  },
  {
    name: 'reply-to-thread',
    description: 'Reply to an existing open review thread. Replies carry the reviewer prefix applied by the server.',
  },
  {
    name: 'record-completion',
    description:
      'Record reviewer completion and satisfaction. Persists the review with completion provenance; retrying is idempotent.',
  },
  {
    name: 'resolve-thread',
    description: 'Resolve a review thread, but only when workflow policy permits it and this reviewer owns the thread.',
  },
] as const

function toolResult(content: string, isError: boolean) {
  return {
    content: [{
      type: 'text',
      text: content 
    }],
    isError 
  }
}

type JsonRpcId = string | number | null

function errorResult(code: number, message: string, id: JsonRpcId) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: {
      code,
      message 
    } 
  }
}

/** @riviere-role external-client-model */
export interface ReviewerFeedbackMcpServerDeps {
  readonly service: ReviewerFeedbackService
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
  readonly serverName?: string
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/** @riviere-role external-client-service */
export function startReviewerFeedbackMcpServer(deps: ReviewerFeedbackMcpServerDeps): { readonly stop: () => void } {
  const {
    service, input, output 
  } = deps
  const serverName = deps.serverName ?? 'deterministic-agent-workflow-reviewer-feedback'
  const state = {
    stopped: false,
    buffer: '',
  }

  function write(message: unknown): void {
    if (state.stopped) return
    output.write(`${JSON.stringify(message)}\n`)
  }

  async function dispatchTool(name: string, args: unknown): Promise<string> {
    switch (name) {
      case 'read-review-context': {
        readReviewContextInputSchema.parse(args)
        return JSON.stringify(await service.readReviewContext())
      }
      case 'submit-review':
        return JSON.stringify(await service.submitReview(submitReviewInputSchema.parse(args)))
      case 'reply-to-thread':
        return JSON.stringify(await service.replyToThread(replyToThreadInputSchema.parse(args)))
      case 'record-completion':
        return JSON.stringify(await service.recordCompletion(recordCompletionInputSchema.parse(args)))
      case 'resolve-thread':
        return JSON.stringify(await service.resolveThread(resolveThreadInputSchema.parse(args)))
      default:
        throw new ReviewerFeedbackError('policy', `Unknown tool ${name}.`)
    }
  }

  function handleInitialize(id: JsonRpcId, params: unknown): void {
    const parsed = initializeParamsSchema.parse(params)
    const negotiated = supportedProtocolVersions.includes(parsed.protocolVersion)
      ? parsed.protocolVersion
      : latestProtocolVersion
    write({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: {
          name: serverName,
          version: '0.1.0',
        },
      },
    })
  }

  function handleToolsList(id: JsonRpcId): void {
    write({
      jsonrpc: '2.0',
      id,
      result: {
        tools: toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: inputSchemaByOperation[tool.name],
        })),
      },
    })
  }

  function handlePing(id: JsonRpcId): void {
    write({
      jsonrpc: '2.0',
      id,
      result: {},
    })
  }

  async function handleToolsCall(id: JsonRpcId, params: unknown): Promise<void> {
    const parsed = toolsCallParamsSchema.safeParse(params)
    if (!parsed.success) {
      write(errorResult(-32602, 'Invalid tools/call parameters.', id))
      return
    }
    try {
      write({
        jsonrpc: '2.0',
        id,
        result: toolResult(await dispatchTool(parsed.data.name, parsed.data.arguments), false),
      })
      return
    } catch (error) {
      write({
        jsonrpc: '2.0',
        id,
        result: toolErrorResult(error),
      })
    }
  }

  function toolErrorResult(error: unknown) {
    if (error instanceof z.ZodError) {
      return toolResult(
        JSON.stringify({
          kind: 'validation',
          message: `Invalid tool arguments: ${error.message}`,
        }),
        true,
      )
    }
    const kind = error instanceof ReviewerFeedbackError ? error.kind : 'indeterminate'
    const message = error instanceof Error ? error.message : String(error)
    return toolResult(JSON.stringify({
      kind,
      message,
    }), true)
  }

  async function handleRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    if (method === 'initialize') return handleInitialize(id, params)
    if (method === 'tools/list') return handleToolsList(id)
    if (method === 'ping') return handlePing(id)
    if (method === 'tools/call') return handleToolsCall(id, params)
    write(errorResult(-32601, `Method not supported: ${method}.`, id))
  }

  async function handleLine(line: string): Promise<void> {
    if (line.trim().length === 0) return
    if (Buffer.byteLength(line, 'utf8') > maxMessageBytes) {
      write(errorResult(-32700, 'Message exceeds the maximum accepted size.', null))
      return
    }
    const parseOutcome = parseJsonLine(line)
    if (parseOutcome === undefined) {
      write(errorResult(-32700, 'Message is not valid JSON.', null))
      return
    }
    const parsedJson = parseOutcome
    if (typeof parsedJson !== 'object' || parsedJson === null || !('method' in parsedJson)) {
      write(errorResult(-32600, 'Message is not a JSON-RPC request.', null))
      return
    }
    if ('id' in parsedJson) {
      const request = requestEnvelopeSchema.safeParse(parsedJson)
      if (!request.success) {
        write(errorResult(-32600, 'Request envelope is not valid JSON-RPC 2.0.', null))
        return
      }
      await handleRequest(request.data.id, request.data.method, request.data.params)
      return
    }
    notificationEnvelopeSchema.safeParse(parsedJson)
  }

  input.setEncoding('utf8')
  input.on('data', (chunk: string) => {
    state.buffer = state.buffer + chunk
    const lastNewline = state.buffer.lastIndexOf('\n')
    if (lastNewline === -1) return
    const ready = state.buffer.slice(0, lastNewline)
    state.buffer = state.buffer.slice(lastNewline + 1)
    for (const line of ready.split('\n')) {
      void handleLine(line).catch((error: unknown) => {
        write(errorResult(-32603, `Internal server error: ${String(error)}`, null))
      })
    }
  })
  input.on('end', () => {
    state.stopped = true
  })

  return {
    stop: () => {
      state.stopped = true
    },
  }
}
