import { z } from 'zod'
import type {
  ReviewJobStore,
  StoredReviewAgent,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { reviewFindingSchema } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { ReviewerFeedbackStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type {
  GithubApiClient,
  GithubReviewThread,
} from '../../infra/external-clients/github/github-api-client'
import {
  reviewSatisfactionSchema,
  reviewerFeedbackFailureKindSchema,
} from '@nt-ai-lab/deterministic-agent-workflow-event-store'

const singleLineSchema = z.string().trim().min(1).refine(
  (value) => !value.includes('\n') && !value.includes('\r'),
  'Expected a single-line value.',
)

const repositorySchema = singleLineSchema.refine(
  (value) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value),
  'Expected repository in owner/name form.',
)

const reviewerTypeSchema = singleLineSchema.refine(
  (value) => /^[a-z0-9][a-z0-9-]*$/u.test(value) && value.length <= 64,
  'Expected a reviewer type of lowercase letters, digits, and dashes.',
)

export const reviewerFeedbackBoundsSchema = z.object({
  maxReviewComments: z.number().int().positive().max(500).default(50),
  maxThreadReplies: z.number().int().positive().max(500).default(50),
  maxBodyLength: z.number().int().positive().max(65536).default(4000),
  maxCompletionFindings: z.number().int().positive().max(1000).default(100),
}).strict().default({})

export const threadResolutionPolicySchema = z.enum(['forbidden', 'owned-threads'])

export const reviewerFeedbackServerSpecSchema = z.object({
  repository: repositorySchema,
  pullRequestNumber: z.number().int().positive(),
  bundleId: singleLineSchema,
  workflowSessionId: singleLineSchema,
  reviewType: reviewerTypeSchema,
  sourceState: singleLineSchema,
  expectedHeadRevision: singleLineSchema,
  threadResolution: threadResolutionPolicySchema,
  bounds: reviewerFeedbackBoundsSchema,
  databasePath: z.string().min(1),
  restApiBaseUrl: z.string().url().optional(),
  graphqlApiBaseUrl: z.string().url().optional(),
}).strict()

export const submitReviewEventSchema = z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'])

export const reviewCommentInputSchema = z.object({
  path: singleLineSchema,
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
  body: z.string().trim().min(1),
}).strict()

export const submitReviewInputSchema = z.object({
  event: submitReviewEventSchema.default('COMMENT'),
  body: z.string().trim().min(1),
  comments: z.array(reviewCommentInputSchema).max(500).default([]),
}).strict()

export const replyToThreadInputSchema = z.object({
  threadId: singleLineSchema,
  body: z.string().trim().min(1),
}).strict()

export const recordCompletionInputSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  satisfaction: reviewSatisfactionSchema,
  summary: z.string().trim().min(1).optional(),
  findings: z.array(reviewFindingSchema).max(1000).default([]),
}).strict()

export const resolveThreadInputSchema = z.object({ threadId: singleLineSchema }).strict()

export const readReviewContextInputSchema = z.object({}).strict()

/** @riviere-role value-object */
export type ReviewerFeedbackBounds = z.infer<typeof reviewerFeedbackBoundsSchema>
/** @riviere-role value-object */
export type ThreadResolutionPolicy = z.infer<typeof threadResolutionPolicySchema>
/** @riviere-role value-object */
export type ReviewerFeedbackServerSpec = z.infer<typeof reviewerFeedbackServerSpecSchema>
/** @riviere-role value-object */
export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>
/** @riviere-role value-object */
export type ReviewCommentInput = z.infer<typeof reviewCommentInputSchema>
/** @riviere-role value-object */
export type ReplyToThreadInput = z.infer<typeof replyToThreadInputSchema>
/** @riviere-role value-object */
export type RecordCompletionInput = z.infer<typeof recordCompletionInputSchema>
/** @riviere-role value-object */
export type ResolveThreadInput = z.infer<typeof resolveThreadInputSchema>

/** @riviere-role domain-service */
export function reviewerAgentPrefix(reviewType: string): string {
  const validated = reviewerTypeSchema.parse(reviewType)
  return `[${validated}]`
}

export const reviewSubmissionMarkerLead = 'deterministic-agent-workflow-review'

/** @riviere-role domain-service */
export function reviewSubmissionMarker(bundleId: string, reviewType: string): string {
  return `<!-- ${reviewSubmissionMarkerLead}:${bundleId}:${reviewType} -->`
}

/** @riviere-role domain-error */
export class ReviewerFeedbackError extends Error {
  readonly kind: z.infer<typeof reviewerFeedbackFailureKindSchema>

  constructor(
    kind: z.infer<typeof reviewerFeedbackFailureKindSchema>,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ReviewerFeedbackError'
    this.kind = kind
  }
}

/** @riviere-role domain-service */
export function reviewerFeedbackErrorFromStatus(status: number, message: string): ReviewerFeedbackError {
  if (status === 401) return new ReviewerFeedbackError('auth', message)
  if (status === 403) return new ReviewerFeedbackError('permission', message)
  if (status === 404) return new ReviewerFeedbackError('not-found', message)
  if (status === 422) return new ReviewerFeedbackError('validation', message)
  if (status >= 500) return new ReviewerFeedbackError('indeterminate', message)
  return new ReviewerFeedbackError('malformed', message)
}

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

