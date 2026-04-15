import {
  describe, it, expect
} from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSafeTempDir } from '../http-test-fixtures'
import type { TranscriptContentBlock } from './transcript-types'
import { parseJsonlTranscript } from './transcript-parse-jsonl'

function writeJsonlFile(name: string, lines: ReadonlyArray<unknown>): string {
  const dir = createSafeTempDir('transcript-jsonl-')
  const path = join(dir, name)
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8')
  return path
}

class NotAToolResultError extends Error {
  constructor(actualKind: string) {
    super(`Expected tool_result, got ${actualKind}`)
    this.name = 'NotAToolResultError'
  }
}

function expectToolResult(block: TranscriptContentBlock | undefined): {
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean
} {
  if (block?.kind !== 'tool_result') throw new NotAToolResultError(block?.kind ?? 'undefined')
  return {
    toolName: block.toolName,
    text: block.text,
    isError: block.isError,
  }
}

describe('parseJsonlTranscript', () => {
  it('returns empty array for empty file', () => {
    const path = writeJsonlFile('empty.jsonl', [])
    expect(parseJsonlTranscript(path)).toStrictEqual([])
  })

  it('parses an assistant entry with a text block', () => {
    const path = writeJsonlFile('text.jsonl', [{
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        id: 'm1',
        model: 'claude',
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: 'hello',
        }],
      },
    }])
    const entry = parseJsonlTranscript(path)[0]
    expect(entry).toStrictEqual({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      content: [{
        kind: 'text',
        text: 'hello',
      }],
      parentUuid: null,
      isSidechain: false,
      messageId: 'm1',
      model: 'claude',
      stopReason: 'end_turn',
    })
  })

  it('drops empty text blocks', () => {
    const path = writeJsonlFile('empty-text.jsonl', [{
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        content: [{
          type: 'text',
          text: '   ',
        }],
      },
    }])
    expect(parseJsonlTranscript(path)).toStrictEqual([])
  })

  it('parses thinking blocks', () => {
    const path = writeJsonlFile('think.jsonl', [{
      type: 'assistant',
      message: {
        content: [{
          type: 'thinking',
          thinking: 'reasoning',
        }],
      },
    }])
    const entries = parseJsonlTranscript(path)
    expect(entries[0]?.content).toStrictEqual([{
      kind: 'thinking',
      text: 'reasoning',
    }])
  })

  it('parses tool_use + tool_result and pairs by id', () => {
    const path = writeJsonlFile('tool.jsonl', [
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'ls' },
          }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{
              type: 'text',
              text: 'out',
            }],
          }],
        },
      },
    ])
    const entries = parseJsonlTranscript(path)
    expect(entries).toHaveLength(2)
    const result = expectToolResult(entries[1]?.content[0])
    expect(result.toolName).toBe('Bash')
    expect(result.text).toBe('out')
  })

  it('tool_result string content passes through', () => {
    const path = writeJsonlFile('tr-string.jsonl', [{
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tx',
          content: 'raw output',
          is_error: true,
        }],
      },
    }])
    const result = expectToolResult(parseJsonlTranscript(path)[0]?.content[0])
    expect(result.text).toBe('raw output')
    expect(result.isError).toBe(true)
  })

  it('builds a system entry from a text field', () => {
    const path = writeJsonlFile('sys.jsonl', [{
      type: 'system',
      timestamp: '2026-01-01T00:01:00Z',
      text: 'boot',
    }])
    const entry = parseJsonlTranscript(path)[0]
    expect(entry?.type).toBe('system')
    expect(entry?.content).toStrictEqual([{
      kind: 'text',
      text: 'boot',
    }])
  })

  it('drops entries with no recognisable content', () => {
    const path = writeJsonlFile('noop.jsonl', [
      {
        type: 'assistant',
        message: {content: [{ type: 'unknown' }],},
      },
      { not: 'an entry' },
    ])
    expect(parseJsonlTranscript(path)).toStrictEqual([])
  })

  it('skips malformed JSON lines', () => {
    const dir = createSafeTempDir('transcript-jsonl-bad-')
    const path = join(dir, 'bad.jsonl')
    writeFileSync(path, '{not-json}\n{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n', 'utf8')
    const entries = parseJsonlTranscript(path)
    expect(entries).toHaveLength(1)
  })

  it('truncates large tool_result text to 4000 chars', () => {
    const big = 'a'.repeat(5000)
    const path = writeJsonlFile('big.jsonl', [{
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tx',
          content: big,
        }],
      },
    }])
    const result = expectToolResult(parseJsonlTranscript(path)[0]?.content[0])
    expect(result.text).toHaveLength(4000)
  })

  it('carries usage info when present', () => {
    const path = writeJsonlFile('usage.jsonl', [{
      type: 'assistant',
      message: {
        content: [{
          type: 'text',
          text: 'hi',
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      },
    }])
    const entry = parseJsonlTranscript(path)[0]
    expect(entry?.usage).toStrictEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 1,
    })
  })
})
