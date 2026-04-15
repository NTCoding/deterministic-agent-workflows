import {
  mkdtempSync, writeFileSync 
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage } from 'node:http'
import {
  describe, expect, it 
} from 'vitest'
import { z } from 'zod'
import {
  createTestDb,
  insertEvent,
} from '../../../../domain/query/session-queries-test-fixtures'
import {
  createMockRequest,
  createMockResponse,
  parseJsonBody,
} from '../http-test-fixtures'
import {
  handleGetSessionActivity,
  type ActivityHandlerDeps,
} from './activity-handler'

function req(): IncomingMessage {
  return createMockRequest()
}

function route(id?: string) {
  return {
    path: '/api/sessions/test/activity',
    query: new URLSearchParams(),
    params: id === undefined ? {} : { id },
  }
}

function withTranscript(dbPath: string): ActivityHandlerDeps {
  const db = createTestDb()
  insertEvent(db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', {transcriptPath: dbPath,})
  return { queryDeps: { db } }
}

function makeTempPath(fileName: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'activity-handler-'))
  return join(dir, fileName)
}

const responseSchema = z.object({
  overall: z.object({
    totalToolCalls: z.number(),
    toolCounts: z.record(z.number()),
    bashTotal: z.number(),
    tasksDelegated: z.array(z.object({
      subagent: z.string(),
      description: z.string(),
    })),
  }).passthrough(),
  byState: z.array(z.unknown()),
})

describe('activity-handler', () => {
  it('returns 400 when route id is missing', () => {
    const deps: ActivityHandlerDeps = { queryDeps: { db: createTestDb() } }
    const handler = handleGetSessionActivity(deps)
    const res = createMockResponse()

    handler(req(), res.res, route())
    expect(res.written.statusCode).toBe(400)
  })

  it('returns empty activity when transcript path is missing', () => {
    const deps: ActivityHandlerDeps = { queryDeps: { db: createTestDb() } }
    const handler = handleGetSessionActivity(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))

    expect(res.written.statusCode).toBe(200)
    const body = parseJsonBody(res.written.body, responseSchema)
    expect(body.overall.totalToolCalls).toBe(0)
    expect(body.byState).toStrictEqual([])
  })

  it('returns empty activity when transcript file is missing', () => {
    const missingPath = `${makeTempPath('missing')}.jsonl`
    const deps = withTranscript(missingPath)
    const handler = handleGetSessionActivity(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))

    expect(res.written.statusCode).toBe(200)
    const body = parseJsonBody(res.written.body, responseSchema)
    expect(body.overall.totalToolCalls).toBe(0)
  })

  it('parses jsonl transcript tool calls', () => {
    const jsonlPath = makeTempPath('transcript.jsonl')
    writeFileSync(jsonlPath, [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'bash',
              input: { command: 'git status' },
            },
            {
              type: 'tool_use',
              name: 'task',
              input: { description: 'delegate' },
            },
          ],
        },
      }),
      JSON.stringify({ type: 'user' }),
      'not-json',
    ].join('\n'))

    const deps = withTranscript(jsonlPath)
    const handler = handleGetSessionActivity(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))

    const body = parseJsonBody(res.written.body, responseSchema)
    expect(body.overall.totalToolCalls).toBe(2)
    expect(body.overall.toolCounts['bash']).toBe(1)
    expect(body.overall.bashTotal).toBe(1)
    expect(body.overall.tasksDelegated[0]?.subagent).toBe('unknown')
  })

  it('returns empty report for non-jsonl transcripts', () => {
    const dbPath = makeTempPath('transcript.db')
    writeFileSync(dbPath, 'not-a-jsonl-transcript')

    const deps = withTranscript(dbPath)
    const handler = handleGetSessionActivity(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))

    const body = parseJsonBody(res.written.body, responseSchema)
    expect(body.overall.totalToolCalls).toBe(0)
  })

  it('keeps bashTotal at zero when bash was not used', () => {
    const jsonlPath = makeTempPath('transcript-without-bash.jsonl')
    writeFileSync(jsonlPath, JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          name: 'task',
          input: { description: 'delegate work' },
        }],
      },
    }))

    const deps = withTranscript(jsonlPath)
    const handler = handleGetSessionActivity(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))

    const body = parseJsonBody(res.written.body, responseSchema)
    expect(body.overall.totalToolCalls).toBe(1)
    expect(body.overall.toolCounts['task']).toBe(1)
    expect(body.overall.bashTotal).toBe(0)
  })
})
