import { z } from 'zod'
export type {
  ActivityReport,
  ActivityResponse,
  AnalyticsOverviewDto,
  ComparisonDto,
  EventDto,
  PerStateActivity,
  SessionDetailDto,
  SessionListResponse,
  SessionSummaryDto,
  SuggestionDto,
  TranscriptContentBlock,
  TranscriptEntry,
  TranscriptResponse,
  TranscriptTotals,
  TranscriptUsage,
  WebHit,
} from './api-types'

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
  z.object({
    kind: z.literal('text'),
    text: z.string() 
  }),
  z.object({
    kind: z.literal('thinking'),
    text: z.string() 
  }),
  z.object({
    kind: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()) 
  }),
  z.object({
    kind: z.literal('tool_result'),
    toolUseId: z.string(),
    toolName: z.string(),
    text: z.string(),
    isError: z.boolean() 
  }),
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

const fileActivitySchema = z.object({
  path: z.string(),
  count: z.number() 
})
const bashCommandSchema = z.object({
  command: z.string(),
  count: z.number() 
})
const searchQuerySchema = z.object({
  pattern: z.string(),
  count: z.number() 
})
const taskDelegationSchema = z.object({
  subagent: z.string(),
  description: z.string() 
})
const webHitSchema = z.object({
  url: z.string(),
  count: z.number() 
})

const activityReportSchema = z.object({
  totalToolCalls: z.number(),
  toolCounts: z.record(z.number()),
  bashCommands: z.array(bashCommandSchema),
  bashTotal: z.number(),
  filesRead: z.array(fileActivitySchema),
  filesEdited: z.array(fileActivitySchema),
  filesWritten: z.array(fileActivitySchema),
  filesTouchedTotal: z.number(),
  grepSearches: z.array(searchQuerySchema),
  globSearches: z.array(searchQuerySchema),
  tasksDelegated: z.array(taskDelegationSchema),
  webFetches: z.array(webHitSchema),
  webSearches: z.array(webHitSchema),
})

const perStateActivitySchema = z.object({
  state: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  report: activityReportSchema,
})

const activityResponseSchema = z.object({
  overall: activityReportSchema,
  byState: z.array(perStateActivitySchema),
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

  getSessionActivity(id: string) {
    return fetchParsedJson(`/api/sessions/${id}/activity`, activityResponseSchema)
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
