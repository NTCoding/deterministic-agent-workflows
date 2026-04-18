import {
  ApiRequestFailedError, fetchParsedJson
} from '../../api/api-client'
import {
  sessionDetailResponseSchema,
  sessionEventsResponseSchema,
  sessionListResponseSchema,
  sessionReflectionsResponseSchema,
  type SessionDetailResponse,
  type SessionEventsResponse,
  type SessionListResponse,
  type SessionReflectionsResponse,
} from '../../api/schemas'

/** @riviere-role web-tbc */
export class SessionNotFoundError extends Error {
  readonly sessionId: string
  constructor(sessionId: string) {
    super(`Session ${sessionId} not found`)
    this.name = 'SessionNotFoundError'
    this.sessionId = sessionId
  }
}

/** @riviere-role web-tbc */
export type SessionStatusFilter = 'active' | 'complete' | 'stale' | 'all'

/** @riviere-role web-tbc */
export function buildSessionsPath(filter: SessionStatusFilter): string {
  if (filter === 'all') {
    return '/api/sessions'
  }
  return `/api/sessions?status=${filter}`
}

/** @riviere-role web-tbc */
export function fetchSessions(filter: SessionStatusFilter): Promise<SessionListResponse> {
  return fetchParsedJson(buildSessionsPath(filter), sessionListResponseSchema)
}

/** @riviere-role web-tbc */
export function sessionsQueryKey(filter: SessionStatusFilter): readonly [string, SessionStatusFilter] {
  return ['sessions', filter] as const
}

/** @riviere-role web-tbc */
export function buildSessionDetailPath(sessionId: string): string {
  return `/api/sessions/${sessionId}`
}

/** @riviere-role web-tbc */
export async function fetchSessionDetail(sessionId: string): Promise<SessionDetailResponse> {
  try {
    return await fetchParsedJson(buildSessionDetailPath(sessionId), sessionDetailResponseSchema)
  } catch (err) {
    if (err instanceof ApiRequestFailedError && err.status === 404) {
      throw new SessionNotFoundError(sessionId)
    }
    throw err
  }
}

/** @riviere-role web-tbc */
export function sessionDetailQueryKey(sessionId: string): readonly [string, string, string] {
  return ['session', sessionId, 'detail'] as const
}

/** @riviere-role web-tbc */
export function fetchSessionEvents(sessionId: string): Promise<SessionEventsResponse> {
  return fetchParsedJson(`/api/sessions/${sessionId}/events`, sessionEventsResponseSchema)
}

/** @riviere-role web-tbc */
export function sessionEventsQueryKey(sessionId: string): readonly [string, string, string] {
  return ['session', sessionId, 'events'] as const
}

/** @riviere-role web-tbc */
export function fetchSessionReflections(sessionId: string): Promise<SessionReflectionsResponse> {
  return fetchParsedJson(`/api/sessions/${sessionId}/reflections`, sessionReflectionsResponseSchema)
}

/** @riviere-role web-tbc */
export function sessionReflectionsQueryKey(sessionId: string): readonly [string, string, string] {
  return ['session', sessionId, 'reflections'] as const
}
