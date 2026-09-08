import { z } from 'zod'
import { WorkflowStateError } from '@nt-ai-lab/deterministic-agent-workflow-engine'

const singleLineSchema = z.string().trim().min(1).refine(
  (value) => !value.includes('\n') && !value.includes('\r'),
  'Expected a single-line value.',
)

export const reviewerFeedbackOperationSchema = z.enum([
  'read-review-context',
  'submit-review',
  'reply-to-thread',
  'record-completion',
  'resolve-thread',
])

export const reviewerFeedbackFailureKindSchema = z.enum([
  'stale-head',
  'bounds',
  'policy',
  'auth',
  'permission',
  'not-found',
  'validation',
  'malformed',
  'network',
  'indeterminate',
])

export const reviewSatisfactionSchema = z.enum([
  'satisfied',
  'partially-satisfied',
  'unsatisfied',
])

export const githubIdSchema = z.number().int().positive()

export const reviewerSubmissionRecordSchema = z.object({
  bundleId: singleLineSchema,
  reviewType: singleLineSchema,
  headRevision: singleLineSchema,
  githubReviewId: githubIdSchema,
  commentIds: z.array(githubIdSchema),
  submittedAt: singleLineSchema,
}).strict()

export const reviewerThreadOwnershipRecordSchema = z.object({
  bundleId: singleLineSchema,
  reviewType: singleLineSchema,
  threadId: singleLineSchema,
  commentDatabaseId: githubIdSchema.optional(),
  recordedAt: singleLineSchema,
  resolvedAt: singleLineSchema.optional(),
}).strict()

export const reviewerCompletionRecordSchema = z.object({
  bundleId: singleLineSchema,
  reviewType: singleLineSchema,
  verdict: z.enum(['PASS', 'FAIL']),
  satisfaction: reviewSatisfactionSchema,
  reviewId: githubIdSchema.optional(),
  recordedAt: singleLineSchema,
}).strict()

export const reviewerFeedbackFailureRecordSchema = z.object({
  bundleId: singleLineSchema,
  reviewType: singleLineSchema,
  operation: reviewerFeedbackOperationSchema,
  kind: reviewerFeedbackFailureKindSchema,
  message: z.string().min(1),
  recordedAt: singleLineSchema,
}).strict()

/** @riviere-role value-object */
export type ReviewerFeedbackOperation = z.infer<typeof reviewerFeedbackOperationSchema>
/** @riviere-role value-object */
export type ReviewerFeedbackFailureKind = z.infer<typeof reviewerFeedbackFailureKindSchema>
/** @riviere-role value-object */
export type ReviewSatisfaction = z.infer<typeof reviewSatisfactionSchema>
/** @riviere-role value-object */
export type ReviewerSubmissionRecord = z.infer<typeof reviewerSubmissionRecordSchema>
/** @riviere-role value-object */
export type ReviewerThreadOwnershipRecord = z.infer<typeof reviewerThreadOwnershipRecordSchema>
/** @riviere-role value-object */
export type ReviewerCompletionRecord = z.infer<typeof reviewerCompletionRecordSchema>
/** @riviere-role value-object */
export type ReviewerFeedbackFailureRecord = z.infer<typeof reviewerFeedbackFailureRecordSchema>

/** @riviere-role value-object */
export interface ReviewerFeedbackStore {
  findSubmission(bundleId: string, reviewType: string): ReviewerSubmissionRecord | undefined
  recordSubmission(
    bundleId: string,
    reviewType: string,
    submission: {
      readonly headRevision: string
      readonly githubReviewId: number
      readonly commentIds: readonly number[]
    },
    submittedAt: string,
  ): ReviewerSubmissionRecord
  recordThreadOwnership(
    bundleId: string,
    reviewType: string,
    thread: {
      readonly threadId: string;
      readonly commentDatabaseId?: number 
    },
    recordedAt: string,
  ): void
  listThreadOwnership(bundleId: string, reviewType?: string): readonly ReviewerThreadOwnershipRecord[]
  findThreadOwner(bundleId: string, threadId: string): ReviewerThreadOwnershipRecord | undefined
  markThreadResolved(bundleId: string, reviewType: string, threadId: string, resolvedAt: string): void
  findCompletion(bundleId: string, reviewType: string): ReviewerCompletionRecord | undefined
  recordCompletion(
    bundleId: string,
    reviewType: string,
    completion: {
      readonly verdict: 'PASS' | 'FAIL'
      readonly satisfaction: ReviewSatisfaction
      readonly reviewId?: number
    },
    recordedAt: string,
  ): ReviewerCompletionRecord
  recordFailure(
    bundleId: string,
    reviewType: string,
    failure: {
      readonly operation: ReviewerFeedbackOperation
      readonly kind: ReviewerFeedbackFailureKind
      readonly message: string
    },
    recordedAt: string,
  ): void
  listFailures(bundleId: string, reviewType?: string): readonly ReviewerFeedbackFailureRecord[]
}

function requireTimestamp(timestamp: string, label: string): void {
  const parsed = singleLineSchema.safeParse(timestamp)
  if (!parsed.success) {
    throw new WorkflowStateError(`Reviewer feedback ${label} must be a single-line value.`)
  }
}

/** @riviere-role domain-service */
export function createInMemoryReviewerFeedbackStore(): ReviewerFeedbackStore {
  const submissions = new Map<string, ReviewerSubmissionRecord>()
  const threads: ReviewerThreadOwnershipRecord[] = []
  const completions = new Map<string, ReviewerCompletionRecord>()
  const failures: ReviewerFeedbackFailureRecord[] = []

  return {
    findSubmission(bundleId, reviewType) {
      return submissions.get(`${bundleId}\u0000${reviewType}`)
    },
    recordSubmission(bundleId, reviewType, submission, submittedAt) {
      requireTimestamp(submittedAt, 'submission timestamp')
      const key = `${bundleId}\u0000${reviewType}`
      const existing = submissions.get(key)
      if (existing !== undefined) return existing
      const record = reviewerSubmissionRecordSchema.parse({
        bundleId,
        reviewType,
        headRevision: submission.headRevision,
        githubReviewId: submission.githubReviewId,
        commentIds: [...submission.commentIds],
        submittedAt,
      })
      submissions.set(key, record)
      return record
    },
    recordThreadOwnership(bundleId, reviewType, thread, recordedAt) {
      requireTimestamp(recordedAt, 'thread ownership timestamp')
      const duplicate = threads.some((row) =>
        row.bundleId === bundleId && row.reviewType === reviewType &&
        row.threadId === thread.threadId && row.commentDatabaseId === thread.commentDatabaseId)
      if (duplicate) return
      threads.push(reviewerThreadOwnershipRecordSchema.parse({
        bundleId,
        reviewType,
        threadId: thread.threadId,
        recordedAt,
        ...(thread.commentDatabaseId === undefined ? {} : { commentDatabaseId: thread.commentDatabaseId }),
      }))
    },
    listThreadOwnership(bundleId, reviewType) {
      return threads.filter((row) =>
        row.bundleId === bundleId && (reviewType === undefined || row.reviewType === reviewType))
    },
    findThreadOwner(bundleId, threadId) {
      return threads.find((row) => row.bundleId === bundleId && row.threadId === threadId)
    },
    markThreadResolved(bundleId, reviewType, threadId, resolvedAt) {
      requireTimestamp(resolvedAt, 'thread resolution timestamp')
      const owned = threads.filter((row) =>
        row.bundleId === bundleId && row.reviewType === reviewType && row.threadId === threadId)
      if (owned.length === 0) {
        throw new WorkflowStateError(
          `Thread ${threadId} is not owned by reviewer ${reviewType} in bundle ${bundleId}.`,
        )
      }
      for (const row of owned) {
        const index = threads.indexOf(row)
        threads[index] = reviewerThreadOwnershipRecordSchema.parse({
          ...row,
          resolvedAt 
        })
      }
    },
    findCompletion(bundleId, reviewType) {
      return completions.get(`${bundleId}\u0000${reviewType}`)
    },
    recordCompletion(bundleId, reviewType, completion, recordedAt) {
      requireTimestamp(recordedAt, 'completion timestamp')
      const key = `${bundleId}\u0000${reviewType}`
      const existing = completions.get(key)
      if (existing !== undefined) return existing
      const record = reviewerCompletionRecordSchema.parse({
        bundleId,
        reviewType,
        verdict: completion.verdict,
        satisfaction: completion.satisfaction,
        recordedAt,
        ...(completion.reviewId === undefined ? {} : { reviewId: completion.reviewId }),
      })
      completions.set(key, record)
      return record
    },
    recordFailure(bundleId, reviewType, failure, recordedAt) {
      requireTimestamp(recordedAt, 'failure timestamp')
      failures.push(reviewerFeedbackFailureRecordSchema.parse({
        bundleId,
        reviewType,
        operation: failure.operation,
        kind: failure.kind,
        message: failure.message,
        recordedAt,
      }))
    },
    listFailures(bundleId, reviewType) {
      return failures.filter((row) =>
        row.bundleId === bundleId && (reviewType === undefined || row.reviewType === reviewType))
    },
  }
}
