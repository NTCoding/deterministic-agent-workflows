import {
  repositoryMetadataEventSchema as DomainMetadataEventSchema,
  engineEventSchema as EngineEventSchema,
  type DomainMetadataEvent,
  type EngineEvent,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  ParsedEvent,
  SessionSummary,
  SessionStatus,
  PermissionDenials,
  StatePeriod,
  JournalEntry,
} from '../query/query-types'
import { deriveSessionStatus } from '../query/query-types'

/** @riviere-role query-model */
export type SessionProjection = {
  readonly sessionId: string
  readonly currentState: string
  readonly workflowStates: ReadonlyArray<string>
  readonly totalEvents: number
  readonly firstEventAt: string
  readonly lastEventAt: string
  readonly activeAgents: ReadonlyArray<string>
  readonly transitionCount: number
  readonly permissionDenials: PermissionDenials
  readonly repository: string | undefined
  readonly issueNumber: number | undefined
  readonly featureBranch: string | undefined
  readonly prNumber: number | undefined
  readonly statePeriods: ReadonlyArray<StatePeriod>
  readonly journalEntries: ReadonlyArray<JournalEntry>
  readonly journalEntryCount: number
}

type MutableProjection = {
  sessionId: string
  currentState: string
  workflowStates: Array<string>
  totalEvents: number
  firstEventAt: string
  lastEventAt: string
  activeAgents: Array<string>
  transitionCount: number
  permissionDenials: {
    write: number;
    bash: number;
    pluginRead: number;
    idle: number 
  }
  repository: string | undefined
  issueNumber: number | undefined
  featureBranch: string | undefined
  prNumber: number | undefined
  statePeriods: Array<{
    state: string
    startedAt: string
    endedAt: string | undefined
    durationMs: number
  }>
  journalEntries: Array<JournalEntry>
  journalEntryCount: number
}

function createEmptyProjection(sessionId: string): MutableProjection {
  return {
    sessionId,
    currentState: 'initial state',
    workflowStates: [],
    totalEvents: 0,
    firstEventAt: '',
    lastEventAt: '',
    activeAgents: [],
    transitionCount: 0,
    permissionDenials: {
      write: 0,
      bash: 0,
      pluginRead: 0,
      idle: 0 
    },
    repository: undefined,
    issueNumber: undefined,
    featureBranch: undefined,
    prNumber: undefined,
    statePeriods: [],
    journalEntries: [],
    journalEntryCount: 0,
  }
}

function reconstructFlatEvent(event: ParsedEvent): Record<string, unknown> {
  return {
    type: event.type,
    at: event.at,
    ...event.payload 
  }
}

function tryParseEngineEvent(event: ParsedEvent): EngineEvent | undefined {
  const flat = reconstructFlatEvent(event)
  const result = EngineEventSchema.safeParse(flat)
  return result.success ? result.data : undefined
}

function tryParseDomainMetadataEvent(event: ParsedEvent): DomainMetadataEvent | undefined {
  const flat = reconstructFlatEvent(event)
  const result = DomainMetadataEventSchema.safeParse(flat)
  return result.success ? result.data : undefined
}

function applyEngineEvent(projection: MutableProjection, event: EngineEvent): void {
  switch (event.type) {
    case 'session-started':
      applySessionStarted(projection, event)
      return
    case 'transitioned':
      applyTransitioned(projection, event)
      return
    case 'agent-registered':
      if (event.agentId.length > 0 && !projection.activeAgents.includes(event.agentId)) {
        projection.activeAgents.push(event.agentId)
      }
      return
    case 'agent-shut-down':
      removeActiveAgent(projection, event.agentName)
      return
    case 'journal-entry':
      projection.journalEntryCount++
      projection.journalEntries.push({
        agentName: event.agentName,
        content: event.content,
        at: event.at,
        state: projection.currentState,
      })
      return
    case 'write-checked':
      incrementDeniedCount(projection, 'write', event.allowed)
      return
    case 'bash-checked':
      incrementDeniedCount(projection, 'bash', event.allowed)
      return
    case 'plugin-read-checked':
      incrementDeniedCount(projection, 'pluginRead', event.allowed)
      return
    case 'idle-checked':
      incrementDeniedCount(projection, 'idle', event.allowed)
      return
    default:
      return
  }
}

function incrementDeniedCount(
  projection: MutableProjection,
  key: keyof MutableProjection['permissionDenials'],
  allowed: boolean,
): void {
  if (!allowed) {
    projection.permissionDenials[key]++
  }
}

function applySessionStarted(projection: MutableProjection, event: Extract<EngineEvent, { type: 'session-started' }>): void {
  if (event.repository !== undefined && event.repository.length > 0) {
    projection.repository = event.repository
  }
  if (event.currentState !== undefined && event.currentState.length > 0) {
    projection.currentState = event.currentState
  }
  if (event.states !== undefined && event.states.length > 0) {
    projection.workflowStates = [...event.states]
  }
}

function applyTransitioned(projection: MutableProjection, event: Extract<EngineEvent, { type: 'transitioned' }>): void {
  projection.transitionCount++
  const lastPeriod = projection.statePeriods[projection.statePeriods.length - 1]
  if (lastPeriod !== undefined && lastPeriod.endedAt === undefined) {
    lastPeriod.endedAt = event.at
    lastPeriod.durationMs = new Date(event.at).getTime() - new Date(lastPeriod.startedAt).getTime()
  }
  projection.statePeriods.push({
    state: event.to,
    startedAt: event.at,
    endedAt: undefined,
    durationMs: 0,
  })
  projection.currentState = event.to
}

function removeActiveAgent(projection: MutableProjection, agentName: string): void {
  const nextAgents = projection.activeAgents.filter((activeAgent) => activeAgent !== agentName)
  projection.activeAgents = nextAgents
}

function applyDomainMetadataEvent(projection: MutableProjection, event: DomainMetadataEvent): void {
  switch (event.type) {
    case 'issue-recorded':
      projection.issueNumber = event.issueNumber
      break
    case 'branch-recorded':
      projection.featureBranch = event.branch
      break
    case 'pr-recorded':
      projection.prNumber = event.prNumber
      break
  }
}

function applyEventToProjection(projection: MutableProjection, event: ParsedEvent): void {
  projection.totalEvents++
  if (projection.firstEventAt === '') {
    projection.firstEventAt = event.at
  }
  projection.lastEventAt = event.at

  const engineEvent = tryParseEngineEvent(event)
  if (engineEvent !== undefined) {
    applyEngineEvent(projection, engineEvent)
    return
  }

  const metadataEvent = tryParseDomainMetadataEvent(event)
  if (metadataEvent !== undefined) {
    applyDomainMetadataEvent(projection, metadataEvent)
  }
}

/** @riviere-role domain-service */
export function projectSession(
  sessionId: string,
  events: ReadonlyArray<ParsedEvent>,
): SessionProjection {
  const projection = createEmptyProjection(sessionId)
  for (const event of events) {
    applyEventToProjection(projection, event)
  }

  if (projection.statePeriods.length === 0 && projection.firstEventAt !== '') {
    const firstMs = new Date(projection.firstEventAt).getTime()
    const lastMs = new Date(projection.lastEventAt).getTime()
    projection.statePeriods.push({
      state: projection.currentState,
      startedAt: projection.firstEventAt,
      endedAt: projection.lastEventAt,
      durationMs: Math.max(lastMs - firstMs, 1),
    })
  }

  return freezeProjection(projection)
}

/** @riviere-role domain-service */
export function projectSessionSummary(
  projection: SessionProjection,
  now: Date,
): SessionSummary {
  const durationMs =
    projection.firstEventAt && projection.lastEventAt
      ? new Date(projection.lastEventAt).getTime() -
        new Date(projection.firstEventAt).getTime()
      : 0

  const status: SessionStatus = projection.lastEventAt
    ? deriveSessionStatus(projection.lastEventAt, now)
    : 'completed'

  return {
    sessionId: projection.sessionId,
    currentState: projection.currentState,
    workflowStates: projection.workflowStates,
    status,
    totalEvents: projection.totalEvents,
    firstEventAt: projection.firstEventAt,
    lastEventAt: projection.lastEventAt,
    durationMs,
    activeAgents: projection.activeAgents,
    transitionCount: projection.transitionCount,
    permissionDenials: projection.permissionDenials,
    repository: projection.repository,
    issueNumber: projection.issueNumber,
    featureBranch: projection.featureBranch,
    prNumber: projection.prNumber,
  }
}

function freezeProjection(mutable: MutableProjection): SessionProjection {
  const statePeriods = mutable.statePeriods.map((period) => ({ ...period }))
  const lastPeriod = statePeriods[statePeriods.length - 1]
  if (lastPeriod !== undefined && lastPeriod.endedAt === undefined && mutable.lastEventAt) {
    lastPeriod.endedAt = mutable.lastEventAt
    lastPeriod.durationMs = new Date(mutable.lastEventAt).getTime() - new Date(lastPeriod.startedAt).getTime()
  }

  return {
    sessionId: mutable.sessionId,
    currentState: mutable.currentState,
    workflowStates: [...mutable.workflowStates],
    totalEvents: mutable.totalEvents,
    firstEventAt: mutable.firstEventAt,
    lastEventAt: mutable.lastEventAt,
    activeAgents: [...mutable.activeAgents],
    transitionCount: mutable.transitionCount,
    permissionDenials: { ...mutable.permissionDenials },
    repository: mutable.repository,
    issueNumber: mutable.issueNumber,
    featureBranch: mutable.featureBranch,
    prNumber: mutable.prNumber,
    statePeriods,
    journalEntries: [...mutable.journalEntries],
    journalEntryCount: mutable.journalEntryCount,
  }
}

/** @riviere-role value-object */
export type ProjectionCache = {
  readonly get: (sessionId: string) => SessionProjection | undefined
  readonly set: (sessionId: string, projection: SessionProjection) => void
  readonly applyEvent: (event: ParsedEvent) => SessionProjection
  readonly evictStale: (now: Date) => number
  readonly size: () => number
}

const STALE_MS = 30 * 60 * 1000

/** @riviere-role domain-service */
export function createProjectionCache(): ProjectionCache {
  const cache = new Map<string, MutableProjection>()

  return {
    get(sessionId) {
      const projection = cache.get(sessionId)
      return projection ? freezeProjection(projection) : undefined
    },

    set(sessionId, projection) {
      const mutable: MutableProjection = {
        ...projection,
        workflowStates: [...projection.workflowStates],
        activeAgents: [...projection.activeAgents],
        permissionDenials: { ...projection.permissionDenials },
        statePeriods: projection.statePeriods.map((period) => ({ ...period })),
        journalEntries: [...projection.journalEntries],
      }
      cache.set(sessionId, mutable)
    },

    applyEvent(event) {
      const existing = cache.get(event.sessionId)
      if (existing) {
        applyEventToProjection(existing, event)
        return freezeProjection(existing)
      }
      const fresh = createEmptyProjection(event.sessionId)
      applyEventToProjection(fresh, event)
      cache.set(event.sessionId, fresh)
      return freezeProjection(fresh)
    },

    evictStale(now) {
      const threshold = now.getTime() - STALE_MS
      const staleIds = [...cache.entries()]
        .filter(([, projection]) => projection.lastEventAt !== '' && new Date(projection.lastEventAt).getTime() < threshold)
        .map(([id]) => id)
      for (const id of staleIds) {
        cache.delete(id)
      }
      return staleIds.length
    },

    size() {
      return cache.size
    },
  }
}
