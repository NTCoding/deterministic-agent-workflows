import type {
  IncomingMessage, ServerResponse 
} from 'node:http'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import {
  getDistinctSessionIds, getSessionEvents 
} from '../../../../domain/query/session-queries'
import {
  projectSession,
  projectSessionSummary,
} from '../../../../domain/analytics/session-projector'
import {
  computeOverview,
  computeTrends,
  computePatterns,
} from '../../../../domain/analytics/cross-session-analytics'
import { comparesessions } from '../../../../domain/analytics/comparator'
import { computeInsights } from '../../../../domain/analytics/insight-rules'
import { computeSuggestions } from '../../../../domain/analytics/suggestion-rules'
import type { TrendBucket } from '../../../../domain/query/query-types'
import type { RouteParams } from '../router'
import {
  sendJson, sendError 
} from '../router'

/** @riviere-role web-tbc */
export type AnalyticsHandlerDeps = {
  readonly queryDeps: SessionQueryDeps
  readonly now: () => Date
}

function loadAllProjections(deps: AnalyticsHandlerDeps) {
  const sessionIds = getDistinctSessionIds(deps.queryDeps)
  const now = deps.now()

  const projections = sessionIds.map((sessionId) => {
    const events = getSessionEvents(deps.queryDeps, sessionId)
    return projectSession(sessionId, events)
  })

  const summaries = projections.map((projection) => projectSessionSummary(projection, now))

  return {
    projections,
    summaries 
  }
}

function parseTrendBucket(value: string | null): TrendBucket {
  return value === 'week' ? 'week' : 'day'
}

function parseWindowDays(value: string | null): number {
  if (value === '7d') return 7
  if (value === '90d') return 90
  return 30
}

/** @riviere-role web-tbc */
export function handleAnalyticsOverview(
  deps: AnalyticsHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, _route: RouteParams) => void {
  return (_req, res) => {
    const {
      projections, summaries 
    } = loadAllProjections(deps)
    const overview = computeOverview(summaries, projections)
    sendJson(res, 200, overview)
  }
}

/** @riviere-role web-tbc */
export function handleAnalyticsTrends(
  deps: AnalyticsHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const metric = route.query.get('metric') ?? 'duration'
    const window = route.query.get('window')
    const bucket = parseTrendBucket(route.query.get('bucket'))
    const windowDays = parseWindowDays(window)

    const { summaries } = loadAllProjections(deps)
    const dataPoints = computeTrends(summaries, metric, windowDays, bucket)

    sendJson(res, 200, { dataPoints })
  }
}

/** @riviere-role web-tbc */
export function handleAnalyticsPatterns(
  deps: AnalyticsHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, _route: RouteParams) => void {
  return (_req, res) => {
    const { projections } = loadAllProjections(deps)
    const now = deps.now()
    const patterns = computePatterns(projections, now)
    sendJson(res, 200, { patterns })
  }
}

/** @riviere-role web-tbc */
export function handleAnalyticsCompare(
  deps: AnalyticsHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const idA = route.query.get('a')
    const idB = route.query.get('b')

    if (!idA || !idB) {
      sendError(res, 400, 'Both ?a=ID and ?b=ID query params required')
      return
    }

    const now = deps.now()

    const eventsA = getSessionEvents(deps.queryDeps, idA)
    if (eventsA.length === 0) {
      sendError(res, 404, `Session ${idA} not found`)
      return
    }

    const eventsB = getSessionEvents(deps.queryDeps, idB)
    if (eventsB.length === 0) {
      sendError(res, 404, `Session ${idB} not found`)
      return
    }

    const projA = projectSession(idA, eventsA)
    const projB = projectSession(idB, eventsB)

    const summaryA = projectSessionSummary(projA, now)
    const summaryB = projectSessionSummary(projB, now)

    const insightsA = computeInsights(projA, now)
    const insightsB = computeInsights(projB, now)
    const suggestionsA = computeSuggestions(projA, now)
    const suggestionsB = computeSuggestions(projB, now)

    const detailA = {
      ...summaryA,
      journalEntries: projA.journalEntries,
      insights: insightsA,
      suggestions: suggestionsA,
      statePeriods: projA.statePeriods,
    }

    const detailB = {
      ...summaryB,
      journalEntries: projB.journalEntries,
      insights: insightsB,
      suggestions: suggestionsB,
      statePeriods: projB.statePeriods,
    }

    const comparison = comparesessions(detailA, detailB)
    sendJson(res, 200, comparison)
  }
}
