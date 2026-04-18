import { z } from 'zod'
import { fetchParsedJson } from '../../api/api-client'

/** @riviere-role web-tbc */
export const analyticsOverviewSchema = z.object({
  totalSessions: z.number(),
  activeSessions: z.number(),
  completedSessions: z.number(),
  staleSessions: z.number(),
  averageDurationMs: z.number(),
  averageTransitionCount: z.number(),
  averageDenialCount: z.number(),
  totalEvents: z.number(),
  denialHotspots: z.array(z.object({
    type: z.string(),
    count: z.number(),
  }).passthrough()),
  stateTimeDistribution: z.array(z.object({
    state: z.string(),
    totalMs: z.number(),
  }).passthrough()),
}).passthrough()

/** @riviere-role web-tbc */
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

/** @riviere-role web-tbc */
export function fetchAnalyticsOverview(): Promise<AnalyticsOverview> {
  return fetchParsedJson('/api/analytics/overview', analyticsOverviewSchema)
}

/** @riviere-role web-tbc */
export function analyticsOverviewQueryKey(): readonly ['analytics', 'overview'] {
  return ['analytics', 'overview'] as const
}
