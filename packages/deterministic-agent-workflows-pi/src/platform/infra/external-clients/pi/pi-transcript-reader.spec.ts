import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  describe,
  expect,
  it,
} from 'vitest'
import {
  getLatestPiAssistantSettlement,
  PiTranscriptReader,
} from './pi-transcript-reader'

const userEntry = {
  type: 'message',
  id: 'user-entry',
  parentId: null,
  timestamp: '2026-09-03T12:00:00.000Z',
  message: {
    role: 'user',
    content: 'Continue.',
    timestamp: 1,
  },
} as const satisfies SessionEntry

type MessageEntry = Extract<SessionEntry, { readonly type: 'message' }>
type AssistantMessage = Extract<MessageEntry['message'], { readonly role: 'assistant' }>

function assistantEntry(id: string, content: AssistantMessage['content']): MessageEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: '2026-09-03T12:00:00.000Z',
    message: {
      role: 'assistant',
      content,
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'stop',
      timestamp: 1,
    },
  }
}

describe('Pi transcript adapters', () => {
  it('returns no settlement when the branch has no assistant message', () => {
    expect(getLatestPiAssistantSettlement([userEntry])).toBeUndefined()
  })

  it('maps assistant text and ignores non-assistant and non-text content', () => {
    const emptyAssistant = assistantEntry('assistant-empty', [{
      type: 'thinking',
      thinking: 'internal'
    }])
    const textAssistant = assistantEntry('assistant-text', [
      {
        type: 'text',
        text: ' first '
      },
      {
        type: 'toolCall',
        id: 'tool-1',
        name: 'read',
        arguments: {}
      },
      {
        type: 'text',
        text: 'second'
      },
    ])
    const reader = new PiTranscriptReader(() => [userEntry, emptyAssistant, textAssistant])

    expect(reader.readMessages()).toStrictEqual([
      {
        id: 'assistant-empty',
        textContent: undefined
      },
      {
        id: 'assistant-text',
        textContent: 'first \nsecond'
      },
    ])
    expect(getLatestPiAssistantSettlement([userEntry, emptyAssistant, textAssistant])).toStrictEqual({
      id: 'assistant-text',
      stopReason: 'stop',
    })
  })
})
