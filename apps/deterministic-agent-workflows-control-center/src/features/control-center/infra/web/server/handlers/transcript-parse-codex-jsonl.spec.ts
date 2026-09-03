import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'
import { createSafeTempDir } from '../http-test-fixtures'
import { parseJsonlTranscript } from './transcript-parse-jsonl'

function writeJsonl(lines: ReadonlyArray<unknown>): string {
  const path = join(createSafeTempDir('transcript-codex-jsonl-'), 'session.jsonl')
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
  return path
}

describe('parseJsonlTranscript Codex edge cases', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts user input text and rejects malformed response envelopes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'))
    const path = writeJsonl([
      null,
      42,
      {
        type: 'response_item',
        payload: null,
      },
      {
        type: 'response_item',
        payload: 'invalid',
      },
      {
        type: 'response_item',
        payload: {
          type: 'event',
          role: 'user',
          content: [],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'system',
          content: [],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: 'invalid',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [],
        },
      },
      {
        type: 'response_item',
        timestamp: 123,
        payload: {
          type: 'message',
          role: 'user',
          content: [
            null,
            'invalid',
            {
              type: 'image',
              data: 'ignored',
            },
            {
              type: 'input_text',
              text: 123,
            },
            {
              type: 'input_text',
              text: 'Codex prompt',
            },
          ],
        },
      },
    ])

    expect(parseJsonlTranscript(path)).toStrictEqual([{
      type: 'user',
      timestamp: '2026-09-02T12:00:00.000Z',
      content: [{
        kind: 'text',
        text: 'Codex prompt',
      }],
    }])
  })
})
