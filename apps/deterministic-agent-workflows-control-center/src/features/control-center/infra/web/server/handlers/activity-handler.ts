import type {
  IncomingMessage, ServerResponse 
} from 'node:http'
import { existsSync } from 'node:fs'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import {
  getTranscriptPath, getSessionEvents, getInitialState 
} from '../../../../domain/query/session-queries'
import { projectSession } from '../../../../domain/analytics/session-projector'
import type { RouteParams } from '../router'
import {
  sendJson, sendError 
} from '../router'
import type {
  ActivityResponse, PerStateActivity, ToolCall 
} from './activity-types'
import { parseTs } from './activity-types'
import {
  extractToolCallsFromJsonl, extractToolCallsFromOpencode 
} from './activity-tool-calls'
import { buildActivityReport } from './activity-report'

export type {
  ActivityReport,
  ActivityResponse,
  BashCommand,
  FileActivity,
  PerStateActivity,
  SearchQuery,
  TaskDelegation,
  WebHit,
} from './activity-types'

/** @riviere-role web-tbc */
export type ActivityHandlerDeps = {readonly queryDeps: SessionQueryDeps}

type StatePeriod = {
  readonly state: string
  readonly startedAtMs: number
  readonly endedAtMs: number
}

type RawPeriod = {
  readonly state: string;
  readonly startedAt: string;
  readonly endedAt?: string | undefined;
  readonly startedAtMs: number;
  readonly endedAtMs: number
}

function loadStatePeriods(deps: SessionQueryDeps, sessionId: string): ReadonlyArray<RawPeriod> {
  const events = getSessionEvents(deps, sessionId)
  if (events.length === 0) return []
  const projection = projectSession(sessionId, events)
  return projection.statePeriods.map((p) => ({
    state: p.state,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    startedAtMs: parseTs(p.startedAt),
    endedAtMs: p.endedAt ? parseTs(p.endedAt) : Number.POSITIVE_INFINITY,
  }))
}

const UNASSIGNED_IDX = -1

function bucketCallsByState(
  calls: ReadonlyArray<ToolCall>,
  periods: ReadonlyArray<StatePeriod>,
): Map<number, Array<ToolCall>> {
  const buckets = new Map<number, Array<ToolCall>>()
  buckets.set(UNASSIGNED_IDX, [])
  periods.forEach((_, i) => buckets.set(i, []))
  for (const call of calls) {
    const idx = periods.findIndex(p => call.timestampMs >= p.startedAtMs && call.timestampMs <= p.endedAtMs)
    buckets.get(idx === -1 ? UNASSIGNED_IDX : idx)?.push(call)
  }
  return buckets
}

function loadCalls(transcriptPath: string | null, sessionId: string, res: ServerResponse): ReadonlyArray<ToolCall> | null {
  if (transcriptPath === null || !existsSync(transcriptPath)) return []
  try {
    if (transcriptPath.endsWith('.jsonl')) return extractToolCallsFromJsonl(transcriptPath)
    if (transcriptPath.endsWith('.db')) return extractToolCallsFromOpencode(transcriptPath, sessionId)
    return []
  } catch (error) {
    sendError(res, 500, `Failed to read transcript for activity: ${String(error)}`)
    return null
  }
}

function buildUnassignedPeriod(
  deps: SessionQueryDeps,
  sessionId: string,
  unassignedCalls: ReadonlyArray<ToolCall>,
): PerStateActivity | null {
  if (unassignedCalls.length === 0) return null
  const initial = getInitialState(deps, sessionId)
  const firstTs = unassignedCalls[0]?.timestampMs ?? 0
  const lastTs = unassignedCalls[unassignedCalls.length - 1]?.timestampMs ?? firstTs
  const fallbackStart = firstTs > 0 ? new Date(firstTs).toISOString() : ''
  return {
    state: initial?.state ?? 'PRE-WORKFLOW',
    startedAt: initial?.startedAt ?? fallbackStart,
    endedAt: lastTs > 0 ? new Date(lastTs).toISOString() : null,
    report: buildActivityReport(unassignedCalls),
  }
}

function buildByState(
  deps: SessionQueryDeps,
  sessionId: string,
  calls: ReadonlyArray<ToolCall>,
  periodsRaw: ReadonlyArray<RawPeriod>,
): ReadonlyArray<PerStateActivity> {
  const periods: ReadonlyArray<StatePeriod> = periodsRaw.map(p => ({
    state: p.state,
    startedAtMs: p.startedAtMs,
    endedAtMs: p.endedAtMs,
  }))
  const buckets = bucketCallsByState(calls, periods)
  const result: Array<PerStateActivity> = []
  const unassigned = buildUnassignedPeriod(deps, sessionId, buckets.get(UNASSIGNED_IDX) ?? [])
  if (unassigned) result.push(unassigned)
  periodsRaw.forEach((p, i) => {
    result.push({
      state: p.state,
      startedAt: p.startedAt,
      endedAt: p.endedAt ?? null,
      report: buildActivityReport(buckets.get(i) ?? []),
    })
  })
  return result
}

/** @riviere-role web-tbc */
export function handleGetSessionActivity(
  deps: ActivityHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (sessionId === undefined || sessionId.length === 0) {
      sendError(res, 400, 'Missing session ID')
      return
    }
    const transcriptPath = getTranscriptPath(deps.queryDeps, sessionId)
    const calls = loadCalls(transcriptPath, sessionId, res)
    if (calls === null) return
    const periodsRaw = loadStatePeriods(deps.queryDeps, sessionId)
    const response: ActivityResponse = {
      overall: buildActivityReport(calls),
      byState: buildByState(deps.queryDeps, sessionId, calls, periodsRaw),
    }
    sendJson(res, 200, response)
  }
}
