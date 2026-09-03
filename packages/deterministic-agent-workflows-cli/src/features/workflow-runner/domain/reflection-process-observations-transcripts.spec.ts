import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  describe,
  expect,
  it,
} from 'vitest'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { buildToolSummary } from './reflection-process-observations'
import type { StatePeriod } from './reflection-process-types'

const temporaryDirectories: string[] = []

function temporaryPath(extension: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'reflection-observations-'))
  temporaryDirectories.push(directory)
  return join(directory, `session.${extension}`)
}

function writeTranscript(lines: readonly string[]): string {
  const path = temporaryPath('jsonl')
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true })
})

describe('buildToolSummary JSONL extraction', () => {
  it('extracts Claude and Pi calls and buckets inclusive timestamps by state', () => {
    const transcriptPath = writeTranscript([
      '',
      'malformed JSON',
      json({ type: 'assistant' }),
      json({
        type: 'assistant',
        message: {}
      }),
      json({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'zero'
          }],
        },
      }),
      json({
        type: 'assistant',
        timestamp: 'not a timestamp',
        message: {
          content: [{
            type: 'tool_use',
            name: 'invalid-time'
          }],
        },
      }),
      json({
        type: 'assistant',
        timestamp: '2026-09-01T10:00:02.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'read'
            },
            {
              type: 'tool_use',
              name: 'read'
            },
            {
              type: 'tool_use',
              name: 'edit'
            },
            {
              type: 'tool_use',
              name: 4
            },
          ],
        },
      }),
      json({
        type: 'message',
        id: 'pi-message',
        parentId: null,
        timestamp: '2026-09-01T10:00:03.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'grep',
              arguments: { pattern: 'TODO' }
            },
            {
              type: 'toolCall',
              id: 'missing-arguments',
              name: 'ignored'
            },
          ],
        },
      }),
      json({
        type: 'assistant',
        timestamp: '2026-09-01T10:00:10.000Z',
        message: {
          content: [{
            type: 'tool_use',
            name: 'outside'
          }],
        },
      }),
      json({
        type: 'message',
        message: {
          role: 'user',
          content: []
        }
      }),
    ])
    const periods: readonly StatePeriod[] = [
      {
        state: 'ZERO',
        startedAt: '1970-01-01T00:00:00.000Z',
        endedAt: '1970-01-01T00:00:00.000Z',
        durationMs: 0
      },
      {
        state: 'PLANNING',
        startedAt: '2026-09-01T10:00:01.000Z',
        endedAt: '2026-09-01T10:00:02.000Z',
        durationMs: 1000
      },
      {
        state: 'DEVELOPING',
        startedAt: '2026-09-01T10:00:02.000Z',
        endedAt: '2026-09-01T10:00:03.000Z',
        durationMs: 1000
      },
    ]

    expect(buildToolSummary(transcriptPath, 'session-1', periods)).toStrictEqual({
      usedToolNames: ['edit', 'grep', 'invalid-time', 'outside', 'read', 'zero'],
      byState: [
        {
          state: 'ZERO',
          totalToolCalls: 2,
          toolCounts: [
            {
              name: 'invalid-time',
              count: 1
            },
            {
              name: 'zero',
              count: 1
            },
          ],
        },
        {
          state: 'PLANNING',
          totalToolCalls: 3,
          toolCounts: [
            {
              name: 'read',
              count: 2
            },
            {
              name: 'edit',
              count: 1
            },
          ],
        },
        {
          state: 'DEVELOPING',
          totalToolCalls: 4,
          toolCounts: [
            {
              name: 'read',
              count: 2
            },
            {
              name: 'edit',
              count: 1
            },
            {
              name: 'grep',
              count: 1
            },
          ],
        },
      ],
    })
  })
})

describe('buildToolSummary OpenCode extraction', () => {
  it('reads session tools with part, message, and epoch timestamp fallbacks', () => {
    const databasePath = temporaryPath('db')
    const database = openSqliteDatabase(databasePath)
    database.exec(`
      CREATE TABLE message (id TEXT, session_id TEXT, time_created);
      CREATE TABLE part (message_id TEXT, time_created, data TEXT);
    `)
    const insertMessage = database.prepare('INSERT INTO message VALUES (?, ?, ?)')
    insertMessage.run('message-1', 'session-1', 1000)
    insertMessage.run('message-2', 'session-1', null)
    insertMessage.run('message-3', 'session-1', 'invalid row timestamp')
    insertMessage.run('message-4', 'other-session', 1000)
    const insertPart = database.prepare('INSERT INTO part VALUES (?, ?, ?)')
    insertPart.run('message-1', 2000, json({
      type: 'tool',
      tool: 'read'
    }))
    insertPart.run('message-1', null, json({
      type: 'tool',
      tool: 'edit'
    }))
    insertPart.run('message-2', null, json({
      type: 'tool',
      tool: 'zero'
    }))
    insertPart.run('message-1', 1500, 'malformed JSON')
    insertPart.run('message-1', 1600, json({
      type: 'text',
      text: 'ignored'
    }))
    insertPart.run('message-3', null, json({
      type: 'tool',
      tool: 'invalid-row'
    }))
    insertPart.run('message-4', 1200, json({
      type: 'tool',
      tool: 'other-session'
    }))
    database.close()
    const periods: readonly StatePeriod[] = [
      {
        state: 'ZERO',
        startedAt: '1970-01-01T00:00:00.000Z',
        endedAt: '1970-01-01T00:00:00.000Z',
        durationMs: 0
      },
      {
        state: 'EARLY',
        startedAt: '1970-01-01T00:00:00.500Z',
        endedAt: '1970-01-01T00:00:01.500Z',
        durationMs: 1000
      },
      {
        state: 'LATE',
        startedAt: '1970-01-01T00:00:01.500Z',
        endedAt: '1970-01-01T00:00:02.500Z',
        durationMs: 1000
      },
    ]

    expect(buildToolSummary(databasePath, 'session-1', periods)).toStrictEqual({
      usedToolNames: ['edit', 'read', 'zero'],
      byState: [
        {
          state: 'ZERO',
          totalToolCalls: 1,
          toolCounts: [{
            name: 'zero',
            count: 1
          }]
        },
        {
          state: 'EARLY',
          totalToolCalls: 1,
          toolCounts: [{
            name: 'edit',
            count: 1
          }]
        },
        {
          state: 'LATE',
          totalToolCalls: 1,
          toolCounts: [{
            name: 'read',
            count: 1
          }]
        },
      ],
    })
  })
})

describe('buildToolSummary missing and malformed transcripts', () => {
  it.each([
    ['missing path', undefined],
    ['empty path', ''],
    ['unsupported extension', temporaryPath('txt')],
    ['missing JSONL file', join(tmpdir(), 'reflection-file-does-not-exist.jsonl')],
  ])('returns empty activity for a %s', (_description, transcriptPath) => {
    expect(buildToolSummary(transcriptPath, 'session-1', [{
      state: 'PLANNING',
      startedAt: '2026-09-01T10:00:00.000Z',
      endedAt: '2026-09-01T10:00:01.000Z',
      durationMs: 1000,
    }])).toStrictEqual({
      usedToolNames: [],
      byState: [{
        state: 'PLANNING',
        totalToolCalls: 0,
        toolCounts: []
      }],
    })
  })

  it('returns empty activity when an OpenCode database cannot be queried', () => {
    const malformedDatabasePath = temporaryPath('db')
    writeFileSync(malformedDatabasePath, '', 'utf8')

    expect(buildToolSummary(malformedDatabasePath, 'session-1', [])).toStrictEqual({
      usedToolNames: [],
      byState: [],
    })
  })
})
