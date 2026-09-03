import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type {
  TranscriptMessage,
  TranscriptReader,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'

/** @riviere-role external-client-model */
export type PiAssistantSettlement = {
  readonly id: string
  readonly stopReason: string
}

/** @riviere-role external-client-service */
export function getLatestPiAssistantSettlement(entries: readonly SessionEntry[]): PiAssistantSettlement | undefined {
  const entry = entries.findLast((candidate) => candidate.type === 'message' && candidate.message.role === 'assistant')
  if (entry?.type !== 'message' || entry.message.role !== 'assistant') return undefined
  return {
    id: entry.id,
    stopReason: entry.message.stopReason,
  }
}

/** @riviere-role external-client-model */
export class PiTranscriptReader implements TranscriptReader {
  constructor(private readonly getBranch: () => readonly SessionEntry[]) {}

  readMessages(): readonly TranscriptMessage[] {
    return this.getBranch().flatMap((entry) => {
      if (entry.type !== 'message' || entry.message.role !== 'assistant') return []
      const text = entry.message.content
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n')
        .trim()
      return [{
        id: entry.id,
        textContent: text.length === 0 ? undefined : text,
      }]
    })
  }
}
