import type {
  ReviewJobStore,
  StoredReviewAgent,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { ReviewerFeedbackStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type {
  GithubApiClient,
  GithubReviewThread,
} from '../../infra/external-clients/github/github-api-client'
import {
  ReviewerFeedbackError,
  reviewerAgentPrefix,
  type RecordCompletionInput,
  type ReplyToThreadInput,
  type ResolveThreadInput,
  type ReviewerFeedbackServerSpec,
  type SubmitReviewInput,
} from './reviewer-feedback-types'

/** @riviere-role value-object */
export interface ReviewContextResult {
  readonly repository: string
  readonly pullRequestNumber: number
  readonly bundleId: string
  readonly workflowSessionId: string
  readonly reviewType: string
  readonly agentPrefix: string
  readonly sourceState: string
  readonly expectedHeadRevision: string
  readonly currentHeadRevision: string | null
  readonly headStatus: 'current' | 'stale' | 'unknown'
  readonly stateInstructions: string
  readonly reviewInstructions: string
  readonly changedFiles: readonly string[]
  readonly threadResolutionPolicy: 'forbidden' | 'owned-threads'
  readonly submission: unknown
  readonly threadOwnership: readonly unknown[]
  readonly openThreads: readonly GithubReviewThread[]
}

/** @riviere-role value-object */
export type SubmitReviewResult =
  | {
    readonly status: 'submitted';
    readonly reviewId: number;
    readonly commentIds: readonly number[]
  }
  | {
    readonly status: 'already-recorded';
    readonly reviewId: number;
    readonly commentIds: readonly number[]
  }

/** @riviere-role value-object */
export type ReplyToThreadResult =
  | {
    readonly status: 'replied';
    readonly threadId: string;
    readonly replyCommentId: number
  }
  | {
    readonly status: 'already-recorded';
    readonly threadId: string;
    readonly replyCommentId: number
  }

/** @riviere-role value-object */
export type RecordCompletionResult =
  | {
    readonly status: 'recorded';
    readonly reviewId: number;
    readonly agentStatus: StoredReviewAgent['status']
  }
  | {
    readonly status: 'already-recorded';
    readonly reviewId: number;
    readonly agentStatus: StoredReviewAgent['status']
  }

/** @riviere-role value-object */
export type ResolveThreadResult =
  | {
    readonly status: 'resolved';
    readonly threadId: string
  }
  | {
    readonly status: 'already-resolved';
    readonly threadId: string
  }

/** @riviere-role value-object */
export interface ReviewerFeedbackServiceDeps {
  readonly spec: ReviewerFeedbackServerSpec
  readonly github: GithubApiClient
  readonly reviewJobStore: ReviewJobStore
  readonly feedbackStore: ReviewerFeedbackStore
  readonly now: () => string
}

/** @riviere-role value-object */
export interface ReviewerFeedbackService {
  readonly readReviewContext: () => Promise<ReviewContextResult>
  readonly submitReview: (input: SubmitReviewInput) => Promise<SubmitReviewResult>
  readonly replyToThread: (input: ReplyToThreadInput) => Promise<ReplyToThreadResult>
  readonly recordCompletion: (input: RecordCompletionInput) => Promise<RecordCompletionResult>
  readonly resolveThread: (input: ResolveThreadInput) => Promise<ResolveThreadResult>
}

/** @riviere-role value-object */
export interface ReviewerOperationContext {
  readonly spec: ReviewerFeedbackServerSpec
  readonly github: GithubApiClient
  readonly reviewJobStore: ReviewJobStore
  readonly feedbackStore: ReviewerFeedbackStore
  readonly now: () => string
  readonly prefix: string
  readonly recordFailure: (
    operation: 'read-review-context' | 'submit-review' | 'reply-to-thread' | 'record-completion' | 'resolve-thread',
    error: unknown,
  ) => void
  readonly requireCurrentHead: () => Promise<string>
  readonly requireOpenThread: (threadId: string) => Promise<GithubReviewThread>
}

/** @riviere-role domain-service */
export function createReviewerOperationContext(
  deps: ReviewerFeedbackServiceDeps,
): ReviewerOperationContext {
  const {
    spec,
    github,
    feedbackStore,
    now,
  } = deps
  return {
    spec,
    github,
    reviewJobStore: deps.reviewJobStore,
    feedbackStore,
    now,
    prefix: reviewerAgentPrefix(spec.reviewType),
    recordFailure: (operation, error) => {
      const kind = error instanceof ReviewerFeedbackError ? error.kind : 'indeterminate'
      const message = error instanceof Error ? error.message : String(error)
      feedbackStore.recordFailure(spec.bundleId, spec.reviewType, {
        operation,
        kind,
        message,
      }, now())
    },
    requireCurrentHead: async () => {
      const head = await github.getPullRequestHeadRevision()
      if (head !== spec.expectedHeadRevision) {
        throw new ReviewerFeedbackError(
          'stale-head',
          `Pull request head is ${head} but this reviewer is fixed to ${spec.expectedHeadRevision}.`,
        )
      }
      return head
    },
    requireOpenThread: async (threadId) => {
      const threads = await github.listReviewThreads()
      const thread = threads.find((candidate) => candidate.id === threadId)
      if (thread === undefined) {
        throw new ReviewerFeedbackError('not-found', `Review thread ${threadId} was not found on the pull request.`)
      }
      return thread
    },
  }
}
