import { parseUnifiedDiff } from '../../infra/external-clients/github/unified-diff'
import {
  ReviewerFeedbackError,
  reviewSubmissionMarker,
  type ReplyToThreadInput,
  type ReviewerFeedbackServerSpec,
  type SubmitReviewInput,
} from './reviewer-feedback-types'
import type {
  ReplyToThreadResult,
  ReviewContextResult,
  ReviewerOperationContext,
  SubmitReviewResult,
} from './reviewer-feedback-contracts'

type Operation = 'read-review-context' | 'submit-review' | 'reply-to-thread' | 'record-completion' | 'resolve-thread'

function requireBounds(spec: ReviewerFeedbackServerSpec, value: string, label: string): void {
  if (value.length > spec.bounds.maxBodyLength) {
    throw new ReviewerFeedbackError(
      'bounds',
      `${label} is ${String(value.length)} characters; the limit is ${String(spec.bounds.maxBodyLength)}.`,
    )
  }
}

/** @riviere-role domain-service */
export function createReviewerFeedbackReadWrite(context: ReviewerOperationContext): {
  readonly readReviewContext: () => Promise<ReviewContextResult>
  readonly submitReview: (input: SubmitReviewInput) => Promise<SubmitReviewResult>
  readonly replyToThread: (input: ReplyToThreadInput) => Promise<ReplyToThreadResult>
} {
  const {
    spec,
    github,
    feedbackStore,
    now,
    prefix,
  } = context

  async function withFailureRecording<T>(operation: Operation, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      context.recordFailure(operation, error)
      throw error
    }
  }

  async function readReviewContext(): Promise<ReviewContextResult> {
    return withFailureRecording('read-review-context', async () => {
      const bundle = context.reviewJobStore.getReviewBundle(spec.bundleId)
      if (bundle === undefined) {
        throw new ReviewerFeedbackError('not-found', `Review bundle ${spec.bundleId} was not found.`)
      }
      const definition = bundle.reviews.find((candidate) => candidate.reviewType === spec.reviewType)
      if (definition === undefined) {
        throw new ReviewerFeedbackError(
          'not-found',
          `Reviewer ${spec.reviewType} is not part of bundle ${spec.bundleId}.`,
        )
      }
      const threads = await github.listReviewThreads()
      const headStatus = await github.getPullRequestHeadRevision().then(
        (head) => head === spec.expectedHeadRevision ? 'current' as const : 'stale' as const,
        () => 'unknown' as const,
      )
      return {
        repository: spec.repository,
        pullRequestNumber: spec.pullRequestNumber,
        bundleId: spec.bundleId,
        workflowSessionId: spec.workflowSessionId,
        reviewType: spec.reviewType,
        agentPrefix: prefix,
        sourceState: spec.sourceState,
        expectedHeadRevision: spec.expectedHeadRevision,
        currentHeadRevision: headStatus === 'unknown' ? null : spec.expectedHeadRevision,
        headStatus,
        stateInstructions: bundle.stateInstructions,
        reviewInstructions: definition.instructions,
        changedFiles: bundle.changedFiles,
        threadResolutionPolicy: spec.threadResolution,
        submission: feedbackStore.findSubmission(spec.bundleId, spec.reviewType),
        threadOwnership: feedbackStore.listThreadOwnership(spec.bundleId, spec.reviewType),
        openThreads: threads,
      }
    })
  }

  async function recordOwnershipForComments(commentIds: readonly number[]): Promise<void> {
    if (commentIds.length === 0) return
    const threads = await github.listReviewThreads()
    for (const thread of threads) {
      for (const comment of thread.comments) {
        if (comment.databaseId !== null && commentIds.includes(comment.databaseId)) {
          feedbackStore.recordThreadOwnership(
            spec.bundleId,
            spec.reviewType,
            {
              threadId: thread.id,
              commentDatabaseId: comment.databaseId,
            },
            now(),
          )
        }
      }
    }
  }

  async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
    return withFailureRecording('submit-review', async () => {
      const recorded = feedbackStore.findSubmission(spec.bundleId, spec.reviewType)
      if (recorded !== undefined) {
        return {
          status: 'already-recorded' as const,
          reviewId: recorded.githubReviewId,
          commentIds: recorded.commentIds,
        }
      }
      requireBounds(spec, input.body, 'Review body')
      if (input.comments.length > spec.bounds.maxReviewComments) {
        throw new ReviewerFeedbackError(
          'bounds',
          `Review carries ${String(input.comments.length)} comments; the limit is ${String(spec.bounds.maxReviewComments)}.`,
        )
      }
      for (const comment of input.comments) {
        requireBounds(spec, comment.body, 'Inline comment body')
      }
      const head = await context.requireCurrentHead()
      const diff = parseUnifiedDiff(await github.getPullRequestDiff())
      for (const comment of input.comments) {
        if (!diff.hasPath(comment.path)) {
          throw new ReviewerFeedbackError('validation', `Path ${comment.path} is not part of the current diff.`)
        }
        const onLine = comment.side === 'RIGHT'
          ? diff.hasRightLine(comment.path, comment.line)
          : diff.hasLeftLine(comment.path, comment.line)
        if (!onLine) {
          throw new ReviewerFeedbackError(
            'validation',
            `Line ${String(comment.line)} on side ${comment.side} is not part of the current diff for ${comment.path}.`,
          )
        }
      }
      const existingReviews = await github.listReviews()
      const reconciled = existingReviews.find((review) =>
        review.body.includes(reviewSubmissionMarker(spec.bundleId, spec.reviewType)))
      if (reconciled !== undefined) {
        const commentIds = await github.listReviewComments(reconciled.id)
        const stored = feedbackStore.recordSubmission(
          spec.bundleId,
          spec.reviewType,
          {
            headRevision: spec.expectedHeadRevision,
            githubReviewId: reconciled.id,
            commentIds,
          },
          now(),
        )
        return {
          status: 'already-recorded' as const,
          reviewId: stored.githubReviewId,
          commentIds: stored.commentIds,
        }
      }
      const created = await github.createReview({
        event: input.event,
        commitId: head,
        body: `${reviewSubmissionMarker(spec.bundleId, spec.reviewType)}\n${prefix} ${input.body}`,
        comments: input.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: `${prefix} ${comment.body}`,
        })),
      })
      feedbackStore.recordSubmission(
        spec.bundleId,
        spec.reviewType,
        {
          headRevision: spec.expectedHeadRevision,
          githubReviewId: created.reviewId,
          commentIds: created.commentIds,
        },
        now(),
      )
      await recordOwnershipForComments(created.commentIds)
      return {
        status: 'submitted' as const,
        reviewId: created.reviewId,
        commentIds: created.commentIds,
      }
    })
  }

  async function replyToThread(input: ReplyToThreadInput): Promise<ReplyToThreadResult> {
    return withFailureRecording('reply-to-thread', async () => {
      requireBounds(spec, input.body, 'Reply body')
      await context.requireCurrentHead()
      const existing = feedbackStore
        .listThreadOwnership(spec.bundleId, spec.reviewType)
        .find((row) => row.threadId === input.threadId)
      if (existing?.commentDatabaseId !== undefined) {
        return {
          status: 'already-recorded' as const,
          threadId: input.threadId,
          replyCommentId: existing.commentDatabaseId,
        }
      }
      const thread = await context.requireOpenThread(input.threadId)
      if (thread.isResolved) {
        throw new ReviewerFeedbackError('policy', `Review thread ${input.threadId} is already resolved.`)
      }
      const rootCommentIds = thread.comments.flatMap((comment) =>
        comment.databaseId === null ? [] : [comment.databaseId])
      if (rootCommentIds.length === 0) {
        throw new ReviewerFeedbackError('malformed', `Review thread ${input.threadId} has no comment to reply to.`)
      }
      const rootCommentId = rootCommentIds[0]
      const reply = await github.createReply({
        commentDatabaseId: rootCommentId,
        body: `${prefix} ${input.body}`,
      })
      feedbackStore.recordThreadOwnership(
        spec.bundleId,
        spec.reviewType,
        {
          threadId: input.threadId,
          commentDatabaseId: reply.commentId,
        },
        now(),
      )
      return {
        status: 'replied' as const,
        threadId: input.threadId,
        replyCommentId: reply.commentId,
      }
    })
  }

  return {
    readReviewContext,
    submitReview,
    replyToThread,
  }
}
