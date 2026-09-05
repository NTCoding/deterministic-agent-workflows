import { z } from 'zod'
import { nonEmptyStringSchema } from './non-empty-string'
import type {
  RecordReviewInput, StoredReview 
} from './review-types'

const promptLineSchema = nonEmptyStringSchema.refine(
  (value) => !value.includes('\n') && !value.includes('\r'),
  'Expected a single-line value.',
)

export const reviewBundleStatusSchema = z.enum([
  'requested',
  'running',
  'completed',
  'failed',
  'cancelled',
])

export const reviewAgentStatusSchema = z.enum([
  'requested',
  'running',
  'completed',
  'failed',
  'cancelled',
])

export const reviewDefinitionSchema = z.object({
  reviewType: nonEmptyStringSchema,
  instructions: nonEmptyStringSchema,
}).strict()

const reviewBundleRequestObjectSchema = z.object({
  bundleId: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  repository: promptLineSchema,
  workingDirectory: nonEmptyStringSchema,
  pullRequestNumber: z.number().int().positive(),
  baseRevision: promptLineSchema,
  headRevision: promptLineSchema,
  changedFiles: z.array(promptLineSchema).min(1),
  stateInstructions: nonEmptyStringSchema,
  reviews: z.array(reviewDefinitionSchema).min(1),
}).strict()

function rejectDuplicateReviewTypes(
  value: { readonly reviews: ReadonlyArray<{ readonly reviewType: string }> },
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>()
  for (const review of value.reviews) {
    if (seen.has(review.reviewType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate review type: ${review.reviewType}`,
        path: ['reviews'],
      })
    }
    seen.add(review.reviewType)
  }
}

export const reviewBundleRequestSchema = reviewBundleRequestObjectSchema.superRefine(
  rejectDuplicateReviewTypes,
)

export const storedReviewBundleSchema = reviewBundleRequestObjectSchema.extend({
  status: reviewBundleStatusSchema,
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
  failureReason: nonEmptyStringSchema.optional(),
}).strict().superRefine(rejectDuplicateReviewTypes)

export const storedReviewAgentSchema = z.object({
  bundleId: nonEmptyStringSchema,
  reviewType: nonEmptyStringSchema,
  status: reviewAgentStatusSchema,
  providerSessionId: nonEmptyStringSchema.optional(),
  reviewId: z.number().int().positive().optional(),
  failureReason: nonEmptyStringSchema.optional(),
  updatedAt: nonEmptyStringSchema,
}).strict()

/** @riviere-role value-object */
export type ReviewBundleStatus = z.infer<typeof reviewBundleStatusSchema>
/** @riviere-role value-object */
export type ReviewAgentStatus = z.infer<typeof reviewAgentStatusSchema>
/** @riviere-role value-object */
export type ReviewDefinition = z.infer<typeof reviewDefinitionSchema>
/** @riviere-role value-object */
export type ReviewBundleRequest = z.infer<typeof reviewBundleRequestSchema>
/** @riviere-role value-object */
export type StoredReviewBundle = z.infer<typeof storedReviewBundleSchema>
/** @riviere-role value-object */
export type StoredReviewAgent = z.infer<typeof storedReviewAgentSchema>

/** @riviere-role value-object */
export interface ReviewJobStore {
  claimReviewBundle(input: ReviewBundleRequest, createdAt: string): StoredReviewBundle
  getReviewBundle(bundleId: string): StoredReviewBundle | undefined
  findActiveReviewBundle(repository: string, pullRequestNumber: number): StoredReviewBundle | undefined
  listReviewAgents(bundleId: string): readonly StoredReviewAgent[]
  markReviewBundleRunning(bundleId: string, updatedAt: string): StoredReviewBundle
  markReviewAgentRunning(
    bundleId: string,
    reviewType: string,
    providerSessionId: string,
    updatedAt: string,
  ): StoredReviewAgent
  completeReviewAgent(
    bundleId: string,
    reviewType: string,
    providerSessionId: string,
    createdAt: string,
    input: RecordReviewInput,
    eventState: string,
  ): {
    readonly agent: StoredReviewAgent;
    readonly review: StoredReview 
  }
  completeReviewBundle(bundleId: string, updatedAt: string): StoredReviewBundle
  failReviewBundle(bundleId: string, reason: string, updatedAt: string): StoredReviewBundle
  cancelReviewBundle(bundleId: string, reason: string, updatedAt: string): StoredReviewBundle
}
