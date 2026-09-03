import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  describe, expect, it,
} from 'vitest'
import { createSafeTempDir } from '../http-test-fixtures'
import { parseJsonlTranscript } from './transcript-parse-jsonl'

function writeJsonl(lines: ReadonlyArray<unknown>): string {
  const path = join(createSafeTempDir('transcript-jsonl-edges-'), 'session.jsonl')
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
  return path
}

describe('parseJsonlTranscript Claude-compatible edge cases', () => {
  it('applies content, metadata, result, and usage defaults', () => {
    const timestamp = '2026-09-02T08:00:00.000Z'
    const systemEntry = {
      type: 'system',
      timestamp,
      payload: 'x'.repeat(600),
    }
    const path = writeJsonl([
      {
        type: 'assistant',
        timestamp,
        parentUuid: 'parent',
        isSidechain: true,
        message: {
          usage: {},
          content: [
            {
              type: 'text',
              text: '  response  '
            },
            {
              type: 'thinking',
              thinking: '   '
            },
            {
              type: 'tool_use',
              name: 'Read'
            },
            {
              type: 'image',
              source: 'ignored'
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp,
        message: {content: [{ type: 'tool_result' }],},
      },
      systemEntry,
      {
        type: 'assistant',
        timestamp,
        message: {}
      },
      {
        type: 'assistant',
        timestamp
      },
    ])

    expect(parseJsonlTranscript(path)).toStrictEqual([
      {
        type: 'assistant',
        timestamp,
        content: [
          {
            kind: 'text',
            text: 'response'
          },
          {
            kind: 'tool_use',
            id: '',
            name: 'Read',
            input: {}
          },
        ],
        parentUuid: 'parent',
        isSidechain: true,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
      {
        type: 'user',
        timestamp,
        content: [{
          kind: 'tool_result',
          toolUseId: '',
          toolName: 'tool',
          text: '',
          isError: false,
        }],
        parentUuid: null,
        isSidechain: false,
      },
      {
        type: 'system',
        timestamp,
        content: [{
          kind: 'text',
          text: JSON.stringify(systemEntry).slice(0, 500)
        }],
        parentUuid: null,
        isSidechain: false,
      },
    ])
  })

  it('pairs named results while ignoring nested image content', () => {
    const path = writeJsonl([
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'call',
            name: 'Bash'
          }],
          usage: 'invalid',
        },
      },
      {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'call',
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
          }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: ''
          }]
        },
      },
    ])
    const entries = parseJsonlTranscript(path)

    expect(entries[0]?.content).toStrictEqual([{
      kind: 'tool_use',
      id: 'call',
      name: 'Bash',
      input: {},
    }])
    expect(entries[0]?.usage).toBeUndefined()
    expect(entries[1]?.content).toStrictEqual([{
      kind: 'tool_result',
      toolUseId: 'call',
      toolName: 'Bash',
      text: 'first\nsecond',
      isError: false,
    }])
    expect(entries[2]?.content).toStrictEqual([{
      kind: 'tool_result',
      toolUseId: '',
      toolName: 'tool',
      text: '',
      isError: false,
    }])
  })

  it('handles whitespace-only files and propagates read failures', () => {
    const path = join(createSafeTempDir('transcript-jsonl-whitespace-'), 'session.jsonl')
    writeFileSync(path, '\n  \n', 'utf8')

    expect(parseJsonlTranscript(path)).toStrictEqual([])
    expect(() => parseJsonlTranscript(`${path}.missing`)).toThrow(/ENOENT/)
  })
})

describe('parseJsonlTranscript Pi edge cases', () => {
  it('filters unsupported blocks and applies assistant usage defaults', () => {
    const path = writeJsonl([
      {
        type: 'message',
        id: 'assistant-empty',
        parentId: null,
        timestamp: '2026-09-02T09:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{
            type: 'image',
            data: 'ignored'
          }]
        },
      },
      {
        type: 'message',
        id: 'assistant-tool',
        parentId: 'user',
        timestamp: '2026-09-02T09:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: '   '
            },
            {
              type: 'image',
              data: 'ignored'
            },
            {
              type: 'toolCall',
              id: 'call',
              name: 'read',
              arguments: {}
            },
          ],
          usage: {},
        },
      },
      {
        type: 'message',
        id: 'result-before-name',
        parentId: null,
        timestamp: '2026-09-02T09:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'unknown',
          toolName: 'fallback-name',
          content: [{
            type: 'image',
            data: 'ignored'
          }],
          isError: false,
        },
      },
      {
        type: 'message',
        id: 'array-user',
        parentId: null,
        timestamp: '2026-09-02T09:00:03.000Z',
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: ' question '
          }]
        },
      },
    ])

    expect(parseJsonlTranscript(path)).toStrictEqual([
      {
        type: 'assistant',
        timestamp: '2026-09-02T09:00:01.000Z',
        parentUuid: 'user',
        isSidechain: false,
        messageId: 'assistant-tool',
        content: [{
          kind: 'tool_use',
          id: 'call',
          name: 'read',
          input: {}
        }],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
      {
        type: 'user',
        timestamp: '2026-09-02T09:00:02.000Z',
        parentUuid: null,
        isSidechain: false,
        messageId: 'result-before-name',
        content: [{
          kind: 'tool_result',
          toolUseId: 'unknown',
          toolName: 'fallback-name',
          text: '',
          isError: false,
        }],
      },
      {
        type: 'user',
        timestamp: '2026-09-02T09:00:03.000Z',
        parentUuid: null,
        isSidechain: false,
        messageId: 'array-user',
        content: [{
          kind: 'text',
          text: 'question'
        }],
      },
    ])
  })

  it('accepts array guidance and drops guidance without visible text', () => {
    const path = writeJsonl([
      {
        type: 'custom_message',
        id: 'guidance',
        parentId: 'parent',
        timestamp: '2026-09-02T09:00:00.000Z',
        customType: 'deterministic-agent-workflow',
        content: [
          {
            type: 'text',
            text: ' Follow the workflow. '
          },
          {
            type: 'image',
            data: 'ignored'
          },
        ],
        display: true,
      },
      {
        type: 'custom_message',
        id: 'empty-guidance',
        parentId: null,
        timestamp: '2026-09-02T09:00:00.000Z',
        customType: 'deterministic-agent-workflow',
        content: [{
          type: 'text',
          text: '   '
        }],
        display: true,
      },
      {
        type: 'custom_message',
        customType: 'other'
      },
    ])

    expect(parseJsonlTranscript(path)).toStrictEqual([{
      type: 'system',
      timestamp: '2026-09-02T09:00:00.000Z',
      parentUuid: 'parent',
      isSidechain: false,
      messageId: 'guidance',
      content: [{
        kind: 'text',
        text: 'Follow the workflow.'
      }],
    }])
  })
})
