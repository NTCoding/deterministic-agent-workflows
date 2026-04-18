import type {
  IncomingMessage, ServerResponse 
} from 'node:http'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import {
  getDistinctSessionIds,
  getSessionEvents,
  getSessionEventsPaginated,
  getSessionReflections,
} from '../../../../domain/query/session-queries'
import {
  projectSession,
  projectSessionSummary,
} from '../../../../domain/analytics/session-projector'
import { computeInsights } from '../../../../domain/analytics/insight-rules'
import { computeSuggestions } from '../../../../domain/analytics/suggestion-rules'
import {
  categorizeEvent,
  extractEventDetail,
  isPermissionDenied,
} from '../../../../domain/query/query-types'
import type {
  AnnotatedEvent, EventCategory 
} from '../../../../domain/query/query-types'
import type { RouteParams } from '../router'
import {
  sendJson, sendError 
} from '../router'

/** @riviere-role web-tbc */
export type SessionHandlerDeps = {
  readonly queryDeps: SessionQueryDeps
  readonly now: () => Date
}

function parseEventCategory(value: string | undefined): EventCategory | undefined {
  return value === 'transition'
    || value === 'agent'
    || value === 'permission'
    || value === 'journal'
    || value === 'session'
    || value === 'domain'
    ? value
    : undefined
}

function createStateMap(allEvents: ReadonlyArray<AnnotatedEvent | import('../../../../domain/query/query-types').ParsedEvent>): Map<number, string> {
  const stateMap = new Map<number, string>()
  const state = { current: 'idle' }

  for (const event of allEvents) {
    if (
      event.type === 'session-started'
      && typeof event.payload['currentState'] === 'string'
      && event.payload['currentState'] !== ''
    ) {
      state.current = event.payload['currentState']
    }
    if (event.type === 'transitioned') {
      state.current = String(event.payload['to'] ?? 'unknown')
    }
    stateMap.set(event.seq, state.current)
  }

  return stateMap
}

function annotateEvents(events: ReadonlyArray<import('../../../../domain/query/query-types').ParsedEvent>, stateMap: Map<number, string>): Array<AnnotatedEvent> {
  return events.map((event) => ({
    ...event,
    category: categorizeEvent(event.type),
    state: event.state ?? stateMap.get(event.seq) ?? 'idle',
    detail: extractEventDetail(event),
    denied: isPermissionDenied(event),
  }))
}

/** @riviere-role web-tbc */
export function handleListSessions(
  deps: SessionHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const status = route.query.get('status') ?? undefined
    const limit = parseInt(route.query.get('limit') ?? '50', 10)
    const offset = parseInt(route.query.get('offset') ?? '0', 10)

    const sessionIds = getDistinctSessionIds(deps.queryDeps)
    const now = deps.now()

    const summaries = sessionIds.map((sessionId) => {
      const events = getSessionEvents(deps.queryDeps, sessionId)
      const projection = projectSession(sessionId, events)
      return projectSessionSummary(projection, now)
    })

    const filtered = status
      ? summaries.filter((summary) => summary.status === status)
      : summaries

    const sorted = [...filtered].sort((a, b) =>
      b.lastEventAt.localeCompare(a.lastEventAt),
    )

    const paged = sorted.slice(offset, offset + limit)

    sendJson(res, 200, {
      sessions: paged,
      total: filtered.length 
    })
  }
}

/** @riviere-role web-tbc */
export function handleGetSession(
  deps: SessionHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const events = getSessionEvents(deps.queryDeps, sessionId)
    if (events.length === 0) {
      sendError(res, 404, `Session ${sessionId} not found`)
      return
    }

    const now = deps.now()
    const projection = projectSession(sessionId, events)
    const summary = projectSessionSummary(projection, now)
    const insights = computeInsights(projection, now)
    const suggestions = computeSuggestions(projection, now)

    sendJson(res, 200, {
      ...summary,
      journalEntries: projection.journalEntries,
      insights,
      suggestions,
      statePeriods: projection.statePeriods,
    })
  }
}

/** @riviere-role web-tbc */
export function handleGetSessionEvents(
  deps: SessionHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const limit = parseInt(route.query.get('limit') ?? '100', 10)
    const offset = parseInt(route.query.get('offset') ?? '0', 10)
    const category = parseEventCategory(route.query.get('category') ?? undefined)
    const type = route.query.get('type') ?? undefined
    const denied = parseDeniedParam(route.query.get('denied'))

    const {
      events, total 
    } = getSessionEventsPaginated(
      deps.queryDeps,
      sessionId,
      limit + offset,
      0,
      { type },
    )

    const stateMap = createStateMap(getSessionEvents(deps.queryDeps, sessionId))
    const annotated = annotateEvents(events, stateMap)

    const filtered = annotated
      .filter((event) => category === undefined || event.category === category)
      .filter((event) => denied === undefined || event.denied === denied)

    const paged = filtered.slice(offset, offset + limit)

    sendJson(res, 200, {
      events: paged,
      total: category || denied !== undefined ? filtered.length : total,
    })
  }
}

function parseDeniedParam(value: string | null): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** @riviere-role web-tbc */
export function handleGetSessionJournal(
  deps: SessionHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const events = getSessionEvents(deps.queryDeps, sessionId)
    if (events.length === 0) {
      sendError(res, 404, `Session ${sessionId} not found`)
      return
    }

    const projection = projectSession(sessionId, events)

    sendJson(res, 200, { entries: projection.journalEntries })
  }
}

/** @riviere-role web-tbc */
export function handleGetSessionInsights(
  deps: SessionHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const events = getSessionEvents(deps.queryDeps, sessionId)
    if (events.length === 0) {
      sendError(res, 404, `Session ${sessionId} not found`)
      return
    }

    const now = deps.now()
    const projection = projectSession(sessionId, events)
    const insights = computeInsights(projection, now)

    sendJson(res, 200, { insights })
  }
}

/** @riviere-role web-tbc */
export function handleGetSessionReflections(
  deps: SessionHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const events = getSessionEvents(deps.queryDeps, sessionId)
    if (events.length === 0) {
      sendError(res, 404, `Session ${sessionId} not found`)
      return
    }

    sendJson(res, 200, {reflections: getSessionReflections(deps.queryDeps, sessionId),})
  }
}
