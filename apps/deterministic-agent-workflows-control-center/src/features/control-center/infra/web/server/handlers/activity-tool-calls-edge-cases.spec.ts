import {writeFileSync,} from 'node:fs'
import { join } from 'node:path'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  describe, expect, it,
} from 'vitest'
import { createSafeTempDir } from '../http-test-fixtures'
import {
  extractToolCallsFromJsonl, extractToolCallsFromOpencode,
} from './activity-tool-calls'

function temporaryPath(name: string): string {
  return join(createSafeTempDir('activity-tool-calls-'), name)
}

function writeRawJsonl(raw: string): string {
  const path = temporaryPath('session.jsonl')
  writeFileSync(path, raw, 'utf8')
  return path
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

describe('extractToolCallsFromJsonl edge cases', () => {
  it('ignores malformed entries and applies Claude and Pi defaults', () => {
    const lines = [
      '{malformed}',
      json({ type: 'assistant' }),
      json({
        type: 'assistant',
        timestamp: 'not-a-timestamp',
        message: {
          content: [
            {
              type: 'image',
              source: 'ignored'
            },
            {
              type: 'tool_use',
              name: 'Read'
            },
          ],
        },
      }),
      json({
        type: 'message',
        id: 'result',
        parentId: 'assistant',
        timestamp: '2026-09-02T10:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'paired',
          toolName: 'bash',
          content: [
            {
              type: 'text',
              text: 'first'
            },
            {
              type: 'image',
              data: 'ignored'
            },
            {
              type: 'text',
              text: 'second'
            },
          ],
          isError: false,
        },
      }),
      json({
        type: 'message',
        id: 'empty-result',
        parentId: null,
        timestamp: '2026-09-02T10:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'unused',
          toolName: 'read',
          content: [{
            type: 'image',
            data: 'ignored'
          }],
          isError: true,
        },
      }),
      json({
        type: 'message',
        id: 'assistant',
        parentId: null,
        timestamp: '2026-09-02T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'ignored'
            },
            {
              type: 'toolCall',
              id: 'paired',
              name: 'bash',
              arguments: { command: 'pwd' }
            },
            {
              type: 'toolCall',
              id: 'unpaired',
              name: 'read',
              arguments: {}
            },
          ],
        },
      }),
      '',
    ]
    const path = writeRawJsonl(lines.join('\n'))

    expect(extractToolCallsFromJsonl(path)).toStrictEqual([
      {
        name: 'Read',
        input: {},
        timestampMs: 0,
      },
      {
        id: 'paired',
        name: 'bash',
        input: { command: 'pwd' },
        timestampMs: Date.parse('2026-09-02T10:00:01.000Z'),
        output: 'first\nsecond',
        isError: false,
      },
      {
        id: 'unpaired',
        name: 'read',
        input: {},
        timestampMs: Date.parse('2026-09-02T10:00:01.000Z'),
      },
    ])
  })

  it('handles empty input and propagates file read errors', () => {
    const emptyPath = writeRawJsonl('\n  \n')
    const missingPath = temporaryPath('missing.jsonl')

    expect(extractToolCallsFromJsonl(emptyPath)).toStrictEqual([])
    expect(() => extractToolCallsFromJsonl(missingPath)).toThrow(/ENOENT/)
  })
})

describe('extractToolCallsFromOpencode', () => {
  it('extracts only valid session tool parts with timestamp and input fallbacks', () => {
    const databasePath = temporaryPath('opencode.db')
    const database = openSqliteDatabase(databasePath)
    database.exec(`
      CREATE TABLE message (id TEXT, session_id TEXT, time_created);
      CREATE TABLE part (message_id TEXT, time_created, data);
    `)
    const insertMessage = database.prepare('INSERT INTO message VALUES (?, ?, ?)')
    insertMessage.run('message-zero', 'session-1', null)
    insertMessage.run('message-main', 'session-1', 1000)
    insertMessage.run('message-invalid', 'session-1', 'invalid-time')
    insertMessage.run('message-other', 'session-2', 500)
    const insertPart = database.prepare('INSERT INTO part VALUES (?, ?, ?)')
    insertPart.run('message-zero', null, json({
      type: 'tool',
      tool: 'zero'
    }))
    insertPart.run('message-main', null, json({
      type: 'tool',
      tool: 'fallback',
      state: {}
    }))
    insertPart.run('message-main', 1200, json({
      type: 'tool',
      tool: 'read',
      state: { input: { filePath: 'README.md' } },
    }))
    insertPart.run('message-main', 1300, 'malformed JSON')
    insertPart.run('message-main', 1400, json({
      type: 'text',
      text: 'ignored'
    }))
    insertPart.run('message-main', 1500, 42)
    insertPart.run('message-invalid', null, json({
      type: 'tool',
      tool: 'invalid-row'
    }))
    insertPart.run('message-other', 600, json({
      type: 'tool',
      tool: 'other-session'
    }))
    database.close()

    expect(extractToolCallsFromOpencode(databasePath, 'session-1')).toStrictEqual([
      {
        name: 'zero',
        input: {},
        timestampMs: 0
      },
      {
        name: 'fallback',
        input: {},
        timestampMs: 1000
      },
      {
        name: 'read',
        input: { filePath: 'README.md' },
        timestampMs: 1200
      },
    ])
    expect(extractToolCallsFromOpencode(databasePath, 'missing-session')).toStrictEqual([])
  })

  it('propagates database open and query errors', () => {
    const missingPath = temporaryPath('missing.db')
    const invalidPath = temporaryPath('invalid.db')
    const database = openSqliteDatabase(invalidPath)
    database.exec('CREATE TABLE unrelated (id TEXT)')
    database.close()

    expect(() => extractToolCallsFromOpencode(missingPath, 'session')).toThrow(/unable to open database file/)
    expect(() => extractToolCallsFromOpencode(invalidPath, 'session')).toThrow(/no such table/)
  })
})
