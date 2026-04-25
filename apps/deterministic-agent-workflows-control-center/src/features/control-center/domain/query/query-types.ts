import { z } from 'zod'

export const eventRowSchema = z.object({
  seq: z.number(),
  session_id: z.string(),
  type: z.string(),
  at: z.string(),
  state: z.string().nullable(),
  payload: z.string(),
})

/** @riviere-role query-model */
export type EventRow = z.infer<typeof eventRowSchema>

/** @riviere-role query-model */
export type ParsedEvent = {
  readonly seq: number
  readonly sessionId: string
  readonly type: string
  readonly at: string
  readonly state?: string
  readonly payload: Record<string, unknown>
}

/** @riviere-role query-model */
export type SessionStatus = 'active' | 'stale' | 'completed'

/** @riviere-role query-model */
export type SessionSummary = {
  readonly sessionId: string
  readonly currentState: string
  readonly workflowStates: ReadonlyArray<string>
  readonly status: SessionStatus
  readonly totalEvents: number
  readonly firstEventAt: string
  readonly lastEventAt: string
  readonly durationMs: number
  readonly activeAgents: ReadonlyArray<string>
  readonly transitionCount: number
  readonly permissionDenials: PermissionDenials
  readonly repository: string | undefined
  readonly issueNumber: number | undefined
  readonly featureBranch: string | undefined
  readonly prNumber: number | undefined
}

/** @riviere-role query-model */
export type PermissionDenials = {
  readonly write: number
  readonly bash: number
  readonly pluginRead: number
  readonly idle: number
}

/** @riviere-role query-model */
export type SessionDetail = SessionSummary & {
  readonly journalEntries: ReadonlyArray<JournalEntry>
  readonly insights: ReadonlyArray<Insight>
  readonly suggestions: ReadonlyArray<Suggestion>
  readonly statePeriods: ReadonlyArray<StatePeriod>
}

/** @riviere-role query-model */
export type StatePeriod = {
  readonly state: string
  readonly startedAt: string
  readonly endedAt: string | undefined
  readonly durationMs: number
}

/** @riviere-role query-model */
export type JournalEntry = {
  readonly agentName: string
  readonly content: string
  readonly at: string
  readonly state: string
}

/** @riviere-role query-model */
export type InsightSeverity = 'warning' | 'info' | 'success'

/** @riviere-role query-model */
export type Insight = {
  readonly severity: InsightSeverity
  readonly title: string
  readonly evidence: string
  readonly prompt: string | undefined
}

/** @riviere-role query-model */
export type Suggestion = {
  readonly title: string
  readonly rationale: string
  readonly change: string
  readonly tradeoff: string
  readonly prompt: string | undefined
}

/** @riviere-role query-model */
export type EventCategory = 'transition' | 'agent' | 'permission' | 'journal' | 'session' | 'domain'

/** @riviere-role query-model */
export type AnnotatedEvent = ParsedEvent & {
  readonly category: EventCategory
  readonly state: string
  readonly detail: string
  readonly denied: boolean | undefined
}

/** @riviere-role query-model */
export type AnalyticsOverview = {
  readonly totalSessions: number
  readonly activeSessions: number
  readonly completedSessions: number
  readonly staleSessions: number
  readonly averageDurationMs: number
  readonly averageTransitionCount: number
  readonly averageDenialCount: number
  readonly totalEvents: number
  readonly denialHotspots: ReadonlyArray<DenialHotspot>
  readonly stateTimeDistribution: ReadonlyArray<StateTimeSegment>
}

/** @riviere-role query-model */
export type DenialHotspot = {
  readonly target: string
  readonly count: number
}

/** @riviere-role query-model */
export type StateTimeSegment = {
  readonly state: string
  readonly totalMs: number
  readonly percentage: number
}

/** @riviere-role query-model */
export type TrendDataPoint = {
  readonly bucketStart: string
  readonly value: number
}

/** @riviere-role query-model */
export type TrendBucket = 'day' | 'week'

/** @riviere-role query-model */
export type RecurringPattern = {
  readonly insightTitle: string
  readonly sessionCount: number
  readonly percentage: number
  readonly exampleSessionIds: ReadonlyArray<string>
}

/** @riviere-role query-model */
export type SessionComparison = {
  readonly sessionA: SessionDetail
  readonly sessionB: SessionDetail
  readonly deltas: ComparisonDeltas
}

/** @riviere-role query-model */
export type ComparisonDeltas = {
  readonly durationMs: number
  readonly durationPercent: number
  readonly transitionCount: number
  readonly transitionPercent: number
  readonly totalDenials: number
  readonly denialPercent: number
  readonly eventCount: number
  readonly eventPercent: number
}

export const PERMISSION_EVENT_TYPES = [
  'write-checked',
  'bash-checked',
  'plugin-read-checked',
  'idle-checked',
] as const

export const AGENT_EVENT_TYPES = [
  'agent-registered',
  'agent-shut-down',
  'identity-verified',
  'context-requested',
] as const

const agentEventTypes: ReadonlyArray<string> = AGENT_EVENT_TYPES
const permissionEventTypes: ReadonlyArray<string> = PERMISSION_EVENT_TYPES
const EMPTY_STRING = ''

function getPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getPayloadStringOrEmpty(payload: Record<string, unknown>, key: string): string {
  return getPayloadString(payload, key) ?? EMPTY_STRING
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

/** @riviere-role domain-service */
export function categorizeEvent(type: string): EventCategory {
  if (type === 'transitioned') return 'transition'
  if (type === 'session-started') return 'session'
  if (type === 'journal-entry') return 'journal'
  if (agentEventTypes.includes(type)) return 'agent'
  if (permissionEventTypes.includes(type)) return 'permission'
  return 'domain'
}

/** @riviere-role domain-service */
export function extractEventDetail(event: ParsedEvent): string {
  const payload = event.payload
  const detailByType: Record<string, () => string> = {
    transitioned: () => `${String(payload['from'] ?? '?')} -> ${String(payload['to'] ?? '?')}`,
    'agent-registered': () => `${String(payload['agentType'] ?? '?')}: ${String(payload['agentId'] ?? '?')}`,
    'agent-shut-down': () => getPayloadStringOrEmpty(payload, 'agentName'),
    'journal-entry': () => {
      const content = getPayloadStringOrEmpty(payload, 'content')
      return `${String(payload['agentName'] ?? '?')}: ${truncate(content, 60)}`
    },
    'write-checked': () => getPayloadStringOrEmpty(payload, 'filePath'),
    'bash-checked': () => truncate(getPayloadStringOrEmpty(payload, 'command'), 40),
    'plugin-read-checked': () => getPayloadStringOrEmpty(payload, 'path'),
    'idle-checked': () => getPayloadStringOrEmpty(payload, 'agentName'),
    'identity-verified': () => getPayloadStringOrEmpty(payload, 'status'),
    'context-requested': () => getPayloadStringOrEmpty(payload, 'agentName'),
    'session-started': () => getPayloadStringOrEmpty(payload, 'repository'),
    'review-recorded': () => `${getPayloadStringOrEmpty(payload, 'reviewType')} ${getPayloadStringOrEmpty(payload, 'verdict')}`.trim(),
  }

  const detailFactory = detailByType[event.type]
  if (detailFactory !== undefined) {
    return detailFactory()
  }

  const firstStringValue = Object.values(payload).find(
    (value): value is string => typeof value === 'string' && value !== event.type && value !== event.at,
  )
  return firstStringValue ?? event.type
}

/** @riviere-role domain-service */
export function isPermissionDenied(event: ParsedEvent): boolean | undefined {
  if (!permissionEventTypes.includes(event.type)) return undefined
  return event.payload['allowed'] === false
}

const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** @riviere-role domain-service */
export function deriveSessionStatus(lastEventAt: string, now: Date): SessionStatus {
  const elapsed = now.getTime() - new Date(lastEventAt).getTime()
  if (elapsed < ACTIVE_THRESHOLD_MS) return 'active'
  if (elapsed < STALE_THRESHOLD_MS) return 'stale'
  return 'completed'
}
