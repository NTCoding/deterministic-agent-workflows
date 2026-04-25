/** @riviere-role web-tbc */
export type SessionListResponse = {
  sessions: Array<SessionSummaryDto>
  total: number
}

/** @riviere-role web-tbc */
export type SessionSummaryDto = {
  sessionId: string
  currentState: string
  workflowStates: Array<string>
  status: string
  totalEvents: number
  firstEventAt: string
  lastEventAt: string
  durationMs: number
  activeAgents: Array<string>
  transitionCount: number
  permissionDenials: {
    write: number
    bash: number
    pluginRead: number
    idle: number
  }
  repository?: string | undefined
  issueNumber?: number | undefined
  featureBranch?: string | undefined
  prNumber?: number | undefined
}

/** @riviere-role web-tbc */
export type SuggestionDto = {
  title: string
  rationale: string
  change: string
  tradeoff: string
  prompt?: string | undefined
}

/** @riviere-role web-tbc */
export type SessionDetailDto = SessionSummaryDto & {
  journalEntries: Array<{
    agentName: string
    content: string
    at: string
    state: string
  }>
  insights: Array<{
    severity: string
    title: string
    evidence: string
    prompt?: string | undefined
  }>
  suggestions: Array<SuggestionDto>
  statePeriods: Array<{
    state: string
    startedAt: string
    endedAt?: string | undefined
    durationMs: number
  }>
}

/** @riviere-role web-tbc */
export type EventDto = {
  seq: number
  sessionId: string
  type: string
  at: string
  payload: Record<string, unknown>
  category: string
  state: string
  detail: string
  denied?: boolean | undefined
}

/** @riviere-role web-tbc */
export type TranscriptContentBlock =
  | {
    readonly kind: 'text'
    readonly text: string
  }
  | {
    readonly kind: 'thinking'
    readonly text: string
  }
  | {
    readonly kind: 'tool_use'
    readonly id: string
    readonly name: string
    readonly input: Record<string, unknown>
  }
  | {
    readonly kind: 'tool_result'
    readonly toolUseId: string
    readonly toolName: string
    readonly text: string
    readonly isError: boolean
  }

/** @riviere-role web-tbc */
export type TranscriptUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
}

/** @riviere-role web-tbc */
export type TranscriptEntry = {
  readonly type: 'assistant' | 'user' | 'system' | 'other'
  readonly timestamp: string
  readonly content: ReadonlyArray<TranscriptContentBlock>
  readonly messageId?: string | undefined
  readonly parentUuid?: string | null | undefined
  readonly isSidechain?: boolean | undefined
  readonly model?: string | undefined
  readonly stopReason?: string | undefined
  readonly usage?: TranscriptUsage | undefined
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
export type TranscriptResponse = {
  readonly entries: ReadonlyArray<TranscriptEntry>
  readonly total: number
  readonly transcriptPath: string
  readonly fileSize?: number | undefined
  readonly fileModified?: string | undefined
  readonly totals: TranscriptTotals
  readonly toolCounts: Record<string, number>
  readonly modelsUsed: ReadonlyArray<string>
}

/** @riviere-role web-tbc */
export type AnalyticsOverviewDto = {
  totalSessions: number
  activeSessions: number
  completedSessions: number
  staleSessions: number
  averageDurationMs: number
  averageTransitionCount: number
  averageDenialCount: number
  totalEvents: number
  denialHotspots: Array<{
    target: string
    count: number
  }>
  stateTimeDistribution: Array<{
    state: string
    totalMs: number
    percentage: number
  }>
}

/** @riviere-role web-tbc */
export type ComparisonDto = {
  sessionA: SessionDetailDto
  sessionB: SessionDetailDto
  deltas: {
    durationMs: number
    durationPercent: number
    transitionCount: number
    transitionPercent: number
    totalDenials: number
    denialPercent: number
    eventCount: number
    eventPercent: number
  }
}

/** @riviere-role web-tbc */
export type FileActivity = {
  readonly path: string
  readonly count: number
}

/** @riviere-role web-tbc */
export type BashCommand = {
  readonly command: string
  readonly count: number
}

/** @riviere-role web-tbc */
export type FailedCommand = {
  readonly toolName: string
  readonly command: string
  readonly output: string
  readonly count: number
}

/** @riviere-role web-tbc */
export type SearchQuery = {
  readonly pattern: string
  readonly count: number
}

/** @riviere-role web-tbc */
export type TaskDelegation = {
  readonly subagent: string
  readonly description: string
}

/** @riviere-role web-tbc */
export type WebHit = {
  readonly url: string
  readonly count: number
}

/** @riviere-role web-tbc */
export type ActivityReport = {
  readonly totalToolCalls: number
  readonly toolCounts: Record<string, number>
  readonly bashCommands: ReadonlyArray<BashCommand>
  readonly bashTotal: number
  readonly workflowCommands: ReadonlyArray<BashCommand>
  readonly failedCommands: ReadonlyArray<FailedCommand>
  readonly filesRead: ReadonlyArray<FileActivity>
  readonly filesEdited: ReadonlyArray<FileActivity>
  readonly filesWritten: ReadonlyArray<FileActivity>
  readonly filesTouchedTotal: number
  readonly grepSearches: ReadonlyArray<SearchQuery>
  readonly globSearches: ReadonlyArray<SearchQuery>
  readonly tasksDelegated: ReadonlyArray<TaskDelegation>
  readonly webFetches: ReadonlyArray<WebHit>
  readonly webSearches: ReadonlyArray<WebHit>
}

/** @riviere-role web-tbc */
export type PerStateActivity = {
  readonly state: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly report: ActivityReport
}

/** @riviere-role web-tbc */
export type ActivityResponse = {
  readonly overall: ActivityReport
  readonly byState: ReadonlyArray<PerStateActivity>
}

/** @riviere-role web-tbc */
export type ReflectionEvidenceDto =
  | {
    readonly kind: 'state-period'
    readonly label?: string | undefined
    readonly state: string
    readonly startedAt?: string | undefined
    readonly endedAt?: string | undefined
  }
  | {
    readonly kind: 'event'
    readonly label?: string | undefined
    readonly seq: number
  }
  | {
    readonly kind: 'event-range'
    readonly label?: string | undefined
    readonly startSeq: number
    readonly endSeq: number
  }
  | {
    readonly kind: 'journal-entry'
    readonly label?: string | undefined
    readonly at: string
    readonly agentName?: string | undefined
  }
  | {
    readonly kind: 'transcript-range'
    readonly label?: string | undefined
    readonly startIndex: number
    readonly endIndex: number
  }
  | {
    readonly kind: 'tool-activity'
    readonly label?: string | undefined
    readonly state?: string | undefined
    readonly toolName?: string | undefined
    readonly metric?: string | undefined
  }

/** @riviere-role web-tbc */
export type ReflectionFindingDto = {
  readonly title: string
  readonly category: string
  readonly opportunity: string
  readonly likelyCause: string
  readonly suggestedChange: string
  readonly expectedImpact: string
  readonly confidence?: string | undefined
  readonly evidence: ReadonlyArray<ReflectionEvidenceDto>
}

/** @riviere-role web-tbc */
export type ReflectionPayloadDto = {
  readonly summary?: string | undefined
  readonly findings: ReadonlyArray<ReflectionFindingDto>
}

/** @riviere-role web-tbc */
export type ReflectionDto = {
  readonly id: number
  readonly sessionId: string
  readonly createdAt: string
  readonly label?: string | undefined
  readonly agentName?: string | undefined
  readonly sourceState?: string | undefined
  readonly reflection: ReflectionPayloadDto
}
