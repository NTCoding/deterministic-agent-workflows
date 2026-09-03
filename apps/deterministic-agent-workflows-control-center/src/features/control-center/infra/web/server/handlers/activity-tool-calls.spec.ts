import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  describe, expect, it,
} from 'vitest'
import { createSafeTempDir } from '../http-test-fixtures'
import { extractToolCallsFromJsonl } from './activity-tool-calls'

function writeJsonl(lines: ReadonlyArray<unknown>): string {
  const path = join(createSafeTempDir('activity-pi-jsonl-'), 'session.jsonl')
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
  return path
}

describe('extractToolCallsFromJsonl', () => {
  it('extracts Pi tool calls and pairs their separate results', () => {
    const path = writeJsonl([
      {
        type: 'session',
        id: 'header',
      },
      {
        type: 'message',
        id: 'assistant-message',
        parentId: null,
        timestamp: '2026-09-01T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'pnpm test' },
          }],
        },
      },
      {
        type: 'custom',
        id: 'custom-entry',
        data: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'not-a-call',
            name: 'write',
            arguments: {},
          }],
        },
      },
      {
        type: 'message',
        id: 'result-message',
        parentId: 'assistant-message',
        timestamp: '2026-09-01T10:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{
            type: 'text',
            text: 'tests failed',
          }],
          isError: true,
          timestamp: 1_788_255_202_000,
        },
      },
    ])

    expect(extractToolCallsFromJsonl(path)).toStrictEqual([{
      id: 'call-1',
      name: 'bash',
      input: { command: 'pnpm test' },
      timestampMs: Date.parse('2026-09-01T10:00:01.000Z'),
      output: 'tests failed',
      isError: true,
    }])
  })

  it('preserves Claude tool extraction', () => {
    const path = writeJsonl([{
      type: 'assistant',
      timestamp: '2026-09-01T10:00:01.000Z',
      message: {
        content: [{
          type: 'tool_use',
          name: 'Read',
          input: { file_path: 'src/main.ts' },
        }],
      },
    }])

    expect(extractToolCallsFromJsonl(path)).toStrictEqual([{
      name: 'Read',
      input: { file_path: 'src/main.ts' },
      timestampMs: Date.parse('2026-09-01T10:00:01.000Z'),
    }])
  })
})
