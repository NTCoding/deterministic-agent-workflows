/** @riviere-role web-tbc */
export type TranscriptUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
}

/** @riviere-role web-tbc */
export type TranscriptContentBlock =
  | {
    readonly kind: 'text';
    readonly text: string
  }
  | {
    readonly kind: 'thinking';
    readonly text: string
  }
  | {
    readonly kind: 'tool_use';
    readonly id: string;
    readonly name: string;
    readonly input: Record<string, unknown>
  }
  | {
    readonly kind: 'tool_result';
    readonly toolUseId: string;
    readonly toolName: string;
    readonly text: string;
    readonly isError: boolean
  }

/** @riviere-role web-tbc */
export type TranscriptEntry = {
  readonly type: 'assistant' | 'user' | 'system' | 'other'
  readonly timestamp: string
  readonly content: ReadonlyArray<TranscriptContentBlock>
  readonly messageId?: string
  readonly parentUuid?: string | null
  readonly isSidechain?: boolean
  readonly model?: string
  readonly stopReason?: string
  readonly usage?: TranscriptUsage
}

/** @riviere-role web-tbc */
export type TranscriptTotals = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
  readonly assistantMessages: number
}

/** @riviere-role web-tbc */
export type TranscriptResponseBody = {
  readonly entries: ReadonlyArray<TranscriptEntry>
  readonly total: number
  readonly transcriptPath: string
  readonly fileSize?: number
  readonly fileModified?: string
  readonly totals: TranscriptTotals
  readonly toolCounts: Record<string, number>
  readonly modelsUsed: ReadonlyArray<string>
}

/** @riviere-role web-tbc */
export function safeParseJson(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return null
  }
}
