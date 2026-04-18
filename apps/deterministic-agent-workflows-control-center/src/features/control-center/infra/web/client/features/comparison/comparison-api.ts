import { z } from 'zod'
import { fetchParsedJson } from '../../api/api-client'
import { sessionDetailResponseSchema } from '../../api/schemas'

/** @riviere-role web-tbc */
export const sessionComparisonSchema = z.object({
  sessionA: sessionDetailResponseSchema,
  sessionB: sessionDetailResponseSchema,
}).passthrough()

/** @riviere-role web-tbc */
export type SessionComparison = z.infer<typeof sessionComparisonSchema>

/** @riviere-role web-tbc */
export function fetchSessionComparison(idA: string, idB: string): Promise<SessionComparison> {
  return fetchParsedJson(
    `/api/analytics/compare?a=${idA}&b=${idB}`,
    sessionComparisonSchema,
  )
}

/** @riviere-role web-tbc */
export function sessionComparisonQueryKey(idA: string, idB: string): readonly [string, string, string] {
  return ['comparison', idA, idB] as const
}
