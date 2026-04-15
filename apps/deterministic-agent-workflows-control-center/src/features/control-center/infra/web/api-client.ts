import { z } from 'zod'

const BASE = ''

class ApiError extends Error {
  constructor(status: number) {
    super(`API error: ${status}`)
    this.name = 'ApiError'
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new ApiError(res.status)
  return await res.json()
}

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
    write: number;
    bash: number;
    pluginRead: number;
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
    agentName: string;
    content: string;
    at: string;
    state: string 
  }>
  insights: Array<{
    severity: string;
    title: string;
    evidence: string;
    prompt?: string | undefined
  }>
  suggestions: Array<SuggestionDto>
  statePeriods: Array<{
    state: string;
    startedAt: string;
    endedAt?: string | undefined;
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
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly kind: 'tool_result'; readonly toolUseId: string; readonly toolName: string; readonly text: string; readonly isError: boolean }

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
    target: string;
    count: number 
  }>
  stateTimeDistribution: Array<{
    state: string;
    totalMs: number;
    percentage: number 
  }>
}

/** @riviere-role web-tbc */
export type ComparisonDto = {
  sessionA: SessionDetailDto
  sessionB: SessionDetailDto
  deltas: {
    durationMs: number;
    durationPercent: number
    transitionCount: number;
    transitionPercent: number
    totalDenials: number;
    denialPercent: number
    eventCount: number;
    eventPercent: number
  }
}

const permissionDenialsSchema = z.object({
  write: z.number(),
  bash: z.number(),
  pluginRead: z.number(),
  idle: z.number(),
})

const sessionSummarySchema = z.object({
  sessionId: z.string(),
  currentState: z.string(),
  workflowStates: z.array(z.string()),
  status: z.string(),
  totalEvents: z.number(),
  firstEventAt: z.string(),
  lastEventAt: z.string(),
  durationMs: z.number(),
  activeAgents: z.array(z.string()),
  transitionCount: z.number(),
  permissionDenials: permissionDenialsSchema,
  repository: z.string().optional(),
  issueNumber: z.number().optional(),
  featureBranch: z.string().optional(),
  prNumber: z.number().optional(),
})

const suggestionSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  change: z.string(),
  tradeoff: z.string(),
  prompt: z.string().optional(),
})

const insightSchema = z.object({
  severity: z.string(),
  title: z.string(),
  evidence: z.string(),
  prompt: z.string().optional(),
})

const sessionDetailSchema = sessionSummarySchema.extend({
  journalEntries: z.array(z.object({
    agentName: z.string(),
    content: z.string(),
    at: z.string(),
    state: z.string(),
  })),
  insights: z.array(insightSchema),
  suggestions: z.array(suggestionSchema),
  statePeriods: z.array(z.object({
    state: z.string(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    durationMs: z.number(),
  })),
})

const eventSchema = z.object({
  seq: z.number(),
  sessionId: z.string(),
  type: z.string(),
  at: z.string(),
  payload: z.record(z.unknown()),
  category: z.string(),
  state: z.string(),
  detail: z.string(),
  denied: z.boolean().optional(),
})

const analyticsOverviewSchema = z.object({
  totalSessions: z.number(),
  activeSessions: z.number(),
  completedSessions: z.number(),
  staleSessions: z.number(),
  averageDurationMs: z.number(),
  averageTransitionCount: z.number(),
  averageDenialCount: z.number(),
  totalEvents: z.number(),
  denialHotspots: z.array(z.object({
    target: z.string(),
    count: z.number() 
  })),
  stateTimeDistribution: z.array(z.object({
    state: z.string(),
    totalMs: z.number(),
    percentage: z.number() 
  })),
})

const comparisonSchema = z.object({
  sessionA: sessionDetailSchema,
  sessionB: sessionDetailSchema,
  deltas: z.object({
    durationMs: z.number(),
    durationPercent: z.number(),
    transitionCount: z.number(),
    transitionPercent: z.number(),
    totalDenials: z.number(),
    denialPercent: z.number(),
    eventCount: z.number(),
    eventPercent: z.number(),
  }),
})

const sessionListResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  total: z.number(),
})

const sessionEventsResponseSchema = z.object({
  events: z.array(eventSchema),
  total: z.number(),
})

const analyticsTrendsSchema = z.object({
  dataPoints: z.array(z.object({
    bucketStart: z.string(),
    value: z.number() 
  })),
})

const analyticsPatternsSchema = z.object({
  patterns: z.array(z.object({
    insightTitle: z.string(),
    sessionCount: z.number(),
    percentage: z.number(),
    exampleSessionIds: z.array(z.string()),
  })),
})

async function fetchParsedJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const body = await fetchJson(path)
  return schema.parse(body)
}

const transcriptContentBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('thinking'), text: z.string() }),
  z.object({ kind: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.record(z.unknown()) }),
  z.object({ kind: z.literal('tool_result'), toolUseId: z.string(), toolName: z.string(), text: z.string(), isError: z.boolean() }),
])

const transcriptUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
})

const transcriptEntrySchema = z.object({
  type: z.enum(['assistant', 'user', 'system', 'other']),
  timestamp: z.string(),
  content: z.array(transcriptContentBlockSchema),
  messageId: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  isSidechain: z.boolean().optional(),
  model: z.string().optional(),
  stopReason: z.string().optional(),
  usage: transcriptUsageSchema.optional(),
})

const transcriptTotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  assistantMessages: z.number(),
})

const transcriptResponseSchema = z.object({
  entries: z.array(transcriptEntrySchema),
  total: z.number(),
  transcriptPath: z.string(),
  fileSize: z.number().optional(),
  fileModified: z.string().optional(),
  totals: transcriptTotalsSchema,
  toolCounts: z.record(z.number()),
  modelsUsed: z.array(z.string()),
})

/** @riviere-role web-tbc */
export const api = {
  getSessions(params?: {
    status?: string;
    limit?: number;
    offset?: number 
  }) {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const qs = q.toString()
    const path = qs === '' ? '/api/sessions' : `/api/sessions?${qs}`
    return fetchParsedJson(path, sessionListResponseSchema)
  },

  getSession(id: string) {
    return fetchParsedJson(`/api/sessions/${id}`, sessionDetailSchema)
  },

  getSessionEvents(id: string, params?: {
    limit?: number;
    offset?: number;
    category?: string;
    type?: string;
    denied?: boolean 
  }) {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    if (params?.category) q.set('category', params.category)
    if (params?.type) q.set('type', params.type)
    if (params?.denied !== undefined) q.set('denied', String(params.denied))
    const qs = q.toString()
    return fetchParsedJson(qs === '' ? `/api/sessions/${id}/events` : `/api/sessions/${id}/events?${qs}`, sessionEventsResponseSchema)
  },

  getAnalyticsOverview() {
    return fetchParsedJson('/api/analytics/overview', analyticsOverviewSchema)
  },

  getAnalyticsTrends(params: {
    metric: string;
    window: string;
    bucket: string 
  }) {
    const q = new URLSearchParams(params)
    return fetchParsedJson(`/api/analytics/trends?${q}`, analyticsTrendsSchema)
  },

  getAnalyticsPatterns() {
    return fetchParsedJson('/api/analytics/patterns', analyticsPatternsSchema)
  },

  getComparison(a: string, b: string) {
    return fetchParsedJson(`/api/analytics/compare?a=${a}&b=${b}`, comparisonSchema)
  },

  getTranscript(id: string) {
    return fetchParsedJson(`/api/sessions/${id}/transcript`, transcriptResponseSchema)
  },
}
