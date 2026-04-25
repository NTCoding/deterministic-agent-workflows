import { z } from 'zod'
import type {
  ListedReview,
  RecordReviewInput,
  ReviewFilters,
  StoredReview,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  listedReviewSchema,
  recordReviewInputSchema,
  reviewFiltersSchema,
  storedReviewSchema,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'

export const createReviewsTableSql = `
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review_type TEXT NOT NULL,
    verdict TEXT NOT NULL,
    branch TEXT,
    pull_request_number INTEGER,
    source_state TEXT,
    payload_json TEXT NOT NULL
  )
`

export const createReviewsSessionIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_reviews_session_created_at
  ON reviews (session_id, created_at ASC, id ASC)
`

export const createReviewsTypeVerdictIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_reviews_type_verdict
  ON reviews (review_type, verdict)
`

export const createReviewsBranchIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_reviews_branch
  ON reviews (branch)
`

export const createReviewsPullRequestIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_reviews_pull_request_number
  ON reviews (pull_request_number)
`

export const reviewIdRowSchema = z.object({ id: z.union([z.number(), z.bigint(), z.string()]) })

export const reviewRowsSchema = z.array(z.object({
  id: z.number(),
  session_id: z.string(),
  created_at: z.string(),
  review_type: z.string(),
  verdict: z.string(),
  branch: z.string().nullable(),
  pull_request_number: z.number().nullable(),
  source_state: z.string().nullable(),
  payload_json: z.string(),
}))

export const listedReviewRowsSchema = z.array(z.object({
  id: z.number(),
  session_id: z.string(),
  created_at: z.string(),
  review_type: z.string(),
  verdict: z.string(),
  branch: z.string().nullable(),
  pull_request_number: z.number().nullable(),
  source_state: z.string().nullable(),
  payload_json: z.string(),
  repository: z.string().nullable(),
}))

const persistedReviewPayloadSchema = recordReviewInputSchema.passthrough()

/** @riviere-role value-object */
export type ReviewRow = z.infer<typeof reviewRowsSchema>[number]

/** @riviere-role value-object */
export type ListedReviewRow = z.infer<typeof listedReviewRowsSchema>[number]

/** @riviere-role domain-service */
export function buildReviewFilters(filters: ReviewFilters): {
  readonly conditions: ReadonlyArray<string>
  readonly parameters: ReadonlyArray<string | number>
} {
  const parsed = reviewFiltersSchema.parse(filters)
  const conditions: Array<string> = []
  const parameters: Array<string | number> = []

  if (parsed.repository !== undefined) {
    conditions.push(`(
      SELECT json_extract(events.payload, '$.repository')
      FROM events
      WHERE events.session_id = reviews.session_id AND events.type = 'session-started'
      ORDER BY events.seq ASC
      LIMIT 1
    ) = ?`)
    parameters.push(parsed.repository)
  }

  if (parsed.branch !== undefined) {
    conditions.push('reviews.branch = ?')
    parameters.push(parsed.branch)
  }

  if (parsed.pullRequestNumber !== undefined) {
    conditions.push('reviews.pull_request_number = ?')
    parameters.push(parsed.pullRequestNumber)
  }

  if (parsed.reviewType !== undefined) {
    conditions.push('reviews.review_type = ?')
    parameters.push(parsed.reviewType)
  }

  if (parsed.verdict !== undefined) {
    conditions.push('reviews.verdict = ?')
    parameters.push(parsed.verdict)
  }

  return {
    conditions,
    parameters,
  }
}

/** @riviere-role domain-service */
export function parseStoredReviewRow(row: ReviewRow): StoredReview {
  const parsedPayload: unknown = JSON.parse(row.payload_json)
  return storedReviewSchema.parse({
    ...parseReviewPayload(parsedPayload),
    id: row.id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    reviewType: row.review_type,
    verdict: row.verdict,
    ...(row.branch === null ? {} : { branch: row.branch }),
    ...(row.pull_request_number === null ? {} : { pullRequestNumber: row.pull_request_number }),
    ...(row.source_state === null ? {} : { sourceState: row.source_state }),
  })
}

/** @riviere-role domain-service */
export function parseListedReviewRow(row: ListedReviewRow): ListedReview {
  const parsedPayload: unknown = JSON.parse(row.payload_json)
  return listedReviewSchema.parse({
    ...parseReviewPayload(parsedPayload),
    id: row.id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    reviewType: row.review_type,
    verdict: row.verdict,
    ...(row.branch === null ? {} : { branch: row.branch }),
    ...(row.pull_request_number === null ? {} : { pullRequestNumber: row.pull_request_number }),
    ...(row.source_state === null ? {} : { sourceState: row.source_state }),
    ...(row.repository === null ? {} : { repository: row.repository }),
  })
}

function parseReviewPayload(payload: unknown): {
  readonly summary?: string
  readonly branch?: string
  readonly pullRequestNumber?: number
  readonly findings: RecordReviewInput['findings']
} {
  const parsed = persistedReviewPayloadSchema.parse(payload)
  return {
    findings: parsed.findings,
    ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
    ...(parsed.branch === undefined ? {} : { branch: parsed.branch }),
    ...(parsed.pullRequestNumber === undefined ? {} : { pullRequestNumber: parsed.pullRequestNumber }),
  }
}
