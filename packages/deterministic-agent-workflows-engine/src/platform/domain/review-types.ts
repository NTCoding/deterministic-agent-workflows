import { z } from 'zod'

export const reviewTypeSchema = z.string().min(1)

export const reviewVerdictSchema = z.enum(['PASS', 'FAIL'])

export const reviewFindingSeveritySchema = z.enum(['minor', 'major', 'critical'])

export const reviewFindingStatusSchema = z.enum(['blocking', 'non-blocking', 'accepted-risk'])

export const reviewFindingSchema = z.object({
  title: z.string().min(1).optional(),
  severity: reviewFindingSeveritySchema.optional(),
  status: reviewFindingStatusSchema.optional(),
  rule: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  details: z.string().min(1).optional(),
  recommendation: z.string().min(1).optional(),
}).strict()

export const reviewPayloadSchema = z.object({
  verdict: reviewVerdictSchema,
  summary: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  findings: z.array(reviewFindingSchema),
}).strict()

export const recordReviewInputSchema = reviewPayloadSchema.extend({
  reviewType: reviewTypeSchema,
  sourceState: z.string().min(1).optional(),
}).strict()

export const storedReviewSchema = recordReviewInputSchema.extend({
  id: z.number().int().positive(),
  sessionId: z.string().min(1),
  createdAt: z.string().min(1),
}).strict()

export const listedReviewSchema = storedReviewSchema.extend({ repository: z.string().min(1).optional() }).strict()

export const reviewFiltersSchema = z.object({
  repository: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  reviewType: reviewTypeSchema.optional(),
  verdict: reviewVerdictSchema.optional(),
}).strict()

/** @riviere-role value-object */
export type ReviewType = z.infer<typeof reviewTypeSchema>

/** @riviere-role value-object */
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>

/** @riviere-role value-object */
export type ReviewFindingSeverity = z.infer<typeof reviewFindingSeveritySchema>

/** @riviere-role value-object */
export type ReviewFindingStatus = z.infer<typeof reviewFindingStatusSchema>

/** @riviere-role value-object */
export type ReviewFinding = z.infer<typeof reviewFindingSchema>

/** @riviere-role value-object */
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>

/** @riviere-role value-object */
export type RecordReviewInput = z.infer<typeof recordReviewInputSchema>

/** @riviere-role value-object */
export type StoredReview = z.infer<typeof storedReviewSchema>

/** @riviere-role value-object */
export type ListedReview = z.infer<typeof listedReviewSchema>

/** @riviere-role value-object */
export type ReviewFilters = z.infer<typeof reviewFiltersSchema>
