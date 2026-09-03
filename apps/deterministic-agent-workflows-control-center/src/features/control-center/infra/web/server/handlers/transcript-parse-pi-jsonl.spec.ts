import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  describe, expect, it,
} from 'vitest'
import { createSafeTempDir } from '../http-test-fixtures'
import type { TranscriptContentBlock } from './transcript-types'
import { parseJsonlTranscript } from './transcript-parse-jsonl'

function writeJsonlFile(name: string, lines: ReadonlyArray<unknown>): string {
  const path = join(createSafeTempDir('transcript-pi-jsonl-'), name)
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
  return path
}

function expectToolResult(block: TranscriptContentBlock | undefined): {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean
} {
  if (block?.kind !== 'tool_result') throw new TypeError(`Expected tool_result, got ${block?.kind ?? 'undefined'}`)
  return {
    toolUseId: block.toolUseId,
    toolName: block.toolName,
    text: block.text,
    isError: block.isError,
  }
}

describe('parseJsonlTranscript Pi sessions', () => {
  it('parses user and assistant text with assistant metadata', () => {
    const path = writeJsonlFile('pi-text.jsonl', [
      {
        type: 'session',
        id: 'session-header',
      },
      {
        type: 'message',
        id: 'pi-user',
        parentId: null,
        timestamp: '2026-09-01T10:00:00.000Z',
        message: {
          role: 'user',
          content: 'Build the feature',
          timestamp: 1_788_255_200_000,
        },
      },
      {
        type: 'message',
        id: 'pi-assistant',
        parentId: 'pi-user',
        timestamp: '2026-09-01T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'I will implement it.',
          }],
          model: 'pi-model',
          stopReason: 'stop',
          usage: {
            input: 11,
            output: 7,
            cacheRead: 3,
            cacheWrite: 2,
          },
        },
      },
      {
        type: 'custom',
        id: 'custom-entry',
        data: { role: 'assistant' },
      },
    ])

    expect(parseJsonlTranscript(path)).toStrictEqual([
      {
        type: 'user',
        timestamp: '2026-09-01T10:00:00.000Z',
        content: [{
          kind: 'text',
          text: 'Build the feature',
        }],
        parentUuid: null,
        isSidechain: false,
        messageId: 'pi-user',
      },
      {
        type: 'assistant',
        timestamp: '2026-09-01T10:00:01.000Z',
        content: [{
          kind: 'text',
          text: 'I will implement it.',
        }],
        parentUuid: 'pi-user',
        isSidechain: false,
        messageId: 'pi-assistant',
        model: 'pi-model',
        stopReason: 'stop',
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 2,
        },
      },
    ])
  })

  it('parses and pairs thinking, tool calls, and separate tool results', () => {
    const path = writeJsonlFile('pi-tools.jsonl', [
      {
        type: 'message',
        id: 'pi-assistant',
        parentId: 'pi-user',
        timestamp: '2026-09-01T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Inspect the file first.',
            },
            {
              type: 'toolCall',
              id: 'pi-call-1',
              name: 'read',
              arguments: { path: 'src/main.ts' },
            },
          ],
        },
      },
      {
        type: 'message',
        id: 'pi-result',
        parentId: 'pi-assistant',
        timestamp: '2026-09-01T10:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'pi-call-1',
          toolName: 'read',
          content: [
            {
              type: 'text',
              text: 'file contents',
            },
            {
              type: 'image',
              data: 'ignored',
              mimeType: 'image/png',
            },
          ],
          isError: true,
          timestamp: 1_788_255_202_000,
        },
      },
    ])
    const entries = parseJsonlTranscript(path)

    expect(entries[0]?.content).toStrictEqual([
      {
        kind: 'thinking',
        text: 'Inspect the file first.',
      },
      {
        kind: 'tool_use',
        id: 'pi-call-1',
        name: 'read',
        input: { path: 'src/main.ts' },
      },
    ])
    expect(expectToolResult(entries[1]?.content[0])).toStrictEqual({
      toolUseId: 'pi-call-1',
      toolName: 'read',
      text: 'file contents',
      isError: true,
    })
  })

  it('parses persisted workflow guidance as a system entry', () => {
    const path = writeJsonlFile('pi-workflow-guidance.jsonl', [{
      type: 'custom_message',
      id: 'workflow-guidance',
      parentId: null,
      timestamp: '2026-09-01T10:00:00.000Z',
      customType: 'deterministic-agent-workflow',
      content: 'Remain in PLANNING until the plan is approved.',
      display: true,
    }])

    expect(parseJsonlTranscript(path)).toStrictEqual([{
      type: 'system',
      timestamp: '2026-09-01T10:00:00.000Z',
      content: [{
        kind: 'text',
        text: 'Remain in PLANNING until the plan is approved.',
      }],
      parentUuid: null,
      isSidechain: false,
      messageId: 'workflow-guidance',
    }])
  })
})
