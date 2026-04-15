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
  handleGetTranscript,
  type TranscriptHandlerDeps,
} from './transcript-handler'

function req(): IncomingMessage {
  return createMockRequest()
}

function route(id?: string) {
  return {
    path: '/api/sessions/test/transcript',
    query: new URLSearchParams(),
    params: id === undefined ? {} : { id },
  }
}

function depsWithTranscriptPath(path: string): TranscriptHandlerDeps {
  const db = createTestDb()
  insertEvent(db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', {transcriptPath: path,})
  return { queryDeps: { db } }
}

function tmpPath(fileName: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-handler-'))
  return join(dir, fileName)
}

const transcriptSchema = z.object({
  total: z.number(),
  transcriptPath: z.string(),
  entries: z.array(z.object({
    type: z.string(),
    timestamp: z.string(),
    content: z.array(z.unknown()),
  }).passthrough()),
  totals: z.object({ assistantMessages: z.number() }).passthrough(),
  toolCounts: z.record(z.number()),
  modelsUsed: z.array(z.string()),
}).passthrough()

describe('transcript-handler', () => {
  it('returns 400 when route id is missing', () => {
    const deps: TranscriptHandlerDeps = { queryDeps: { db: createTestDb() } }
    const handler = handleGetTranscript(deps)
    const res = createMockResponse()

    handler(req(), res.res, route())
    expect(res.written.statusCode).toBe(400)
  })

  it('returns 404 when transcript path is missing', () => {
    const deps: TranscriptHandlerDeps = { queryDeps: { db: createTestDb() } }
    const handler = handleGetTranscript(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))
    expect(res.written.statusCode).toBe(404)
  })

  it('returns 404 when transcript file does not exist', () => {
    const path = `${tmpPath('missing-dir')}/does-not-exist.jsonl`
    const deps = depsWithTranscriptPath(path)
    const handler = handleGetTranscript(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))
    expect(res.written.statusCode).toBe(404)
  })

  it('returns 422 for unsupported transcript format', () => {
    const path = tmpPath('transcript.txt')
    writeFileSync(path, 'unsupported')
    const deps = depsWithTranscriptPath(path)
    const handler = handleGetTranscript(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))
    expect(res.written.statusCode).toBe(422)
  })

  it('parses jsonl transcript entries and tool counts', () => {
    const path = tmpPath('transcript.jsonl')
    writeFileSync(path, [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: {
          id: 'm1',
          model: 'claude-sonnet',
          content: [
            {
              type: 'text',
              text: 'hello',
            },
            {
              type: 'tool_use',
              id: 't1',
              name: 'grep',
              input: { pattern: 'abc' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'system',
        timestamp: '2026-01-01T00:00:02Z',
        text: 'system message',
      }),
      JSON.stringify({
        type: 'system',
        timestamp: '2026-01-01T00:00:02Z',
        text: 42,
      }),
      JSON.stringify({
        type: 'other',
        timestamp: '2026-01-01T00:00:03Z',
      }),
      JSON.stringify(123),
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:04Z' }),
      'not-json',
    ].join('\n'))

    const deps = depsWithTranscriptPath(path)
    const handler = handleGetTranscript(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))

    const body = parseJsonBody(res.written.body, transcriptSchema)
    expect(body.total).toBe(3)
    expect(body.toolCounts['grep']).toBe(1)
    expect(body.modelsUsed).toContain('claude-sonnet')
    expect(body.entries[2]?.content[0]).toStrictEqual({
      kind: 'text',
      text: 'unknown',
    })
  })

  it('returns 422 for sqlite transcript paths', () => {
    const path = tmpPath('transcript.db')
    writeFileSync(path, 'sqlite-not-supported')

    const deps = depsWithTranscriptPath(path)
    const handler = handleGetTranscript(deps)
    const res = createMockResponse()

    handler(req(), res.res, route('test-1'))
    expect(res.written.statusCode).toBe(422)
  })
})
