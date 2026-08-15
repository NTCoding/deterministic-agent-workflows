import { z } from 'zod'
import { nonEmptyStringSchema } from './non-empty-string'

export const reviewTypeSchema = nonEmptyStringSchema

export const reviewVerdictSchema = z.enum(['PASS', 'FAIL'])

export const reviewFindingSeveritySchema = z.enum(['minor', 'major', 'critical'])

export const reviewFindingStatusSchema = z.enum(['blocking', 'non-blocking', 'accepted-risk'])

export const reviewFindingSchema = z.object({
  title: nonEmptyStringSchema.optional(),
  severity: reviewFindingSeveritySchema.optional(),
  status: reviewFindingStatusSchema.optional(),
  rule: nonEmptyStringSchema.optional(),
  file: nonEmptyStringSchema.optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  details: nonEmptyStringSchema.optional(),
  recommendation: nonEmptyStringSchema.optional(),
}).strict().superRefine((finding, context) => {
  if (finding.title === undefined && finding.details === undefined && finding.rule === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected review finding to include at least one of title, details, or rule.',
      path: ['title'],
    })
  }
  if (finding.endLine !== undefined && finding.startLine === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected startLine when endLine is provided.',
      path: ['startLine'],
    })
  }
  if (finding.startLine !== undefined && finding.endLine !== undefined && finding.endLine < finding.startLine) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected endLine to be greater than or equal to startLine.',
      path: ['endLine'],
    })
  }
})

export const reviewPayloadSchema = z.object({
  verdict: reviewVerdictSchema,
  summary: nonEmptyStringSchema.optional(),
  branch: nonEmptyStringSchema.optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  findings: z.array(reviewFindingSchema),
}).strict()

export const recordReviewInputSchema = reviewPayloadSchema.extend({
  reviewType: reviewTypeSchema,
  sourceState: nonEmptyStringSchema.optional(),
}).strict()

export const storedReviewSchema = recordReviewInputSchema.extend({
  id: z.number().int().positive(),
  sessionId: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
}).strict()

export const listedReviewSchema = storedReviewSchema.extend({ repository: nonEmptyStringSchema.optional() }).strict()

export const reviewFiltersSchema = z.object({
  repository: nonEmptyStringSchema.optional(),
  branch: nonEmptyStringSchema.optional(),
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
