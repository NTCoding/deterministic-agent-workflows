import { createHash } from 'node:crypto'
import { recordReviewInputSchema } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  RecordCompletionInput,
  ResolveThreadInput,
} from './reviewer-feedback-types'
import { ReviewerFeedbackError } from './reviewer-feedback-types'
import type {
  RecordCompletionResult,
  ResolveThreadResult,
  ReviewerOperationContext,
} from './reviewer-feedback-contracts'

type Operation = 'read-review-context' | 'submit-review' | 'reply-to-thread' | 'record-completion' | 'resolve-thread'

function exactFilesDigest(files: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

function reconcileExistingCompletion(
  context: ReviewerOperationContext,
  input: RecordCompletionInput,
  agent: {
    readonly status: string
    readonly reviewId?: number
  },
): RecordCompletionResult | undefined {
  const {
    spec,
    feedbackStore,
    now,
  } = context
  const recorded = feedbackStore.findCompletion(spec.bundleId, spec.reviewType)
  if (agent.status !== 'completed' && recorded === undefined) return undefined
  const reviewId = agent.reviewId ?? recorded?.reviewId ?? 0
  feedbackStore.recordCompletion(
    spec.bundleId,
    spec.reviewType,
    {
      verdict: input.verdict,
      satisfaction: input.satisfaction,
      reviewId,
    },
    now(),
  )
  return {
    status: 'already-recorded' as const,
    reviewId,
    agentStatus: 'completed',
  }
}

/** @riviere-role domain-service */
export function createReviewerResolution(context: ReviewerOperationContext): {
  readonly recordCompletion: (input: RecordCompletionInput) => Promise<RecordCompletionResult>
  readonly resolveThread: (input: ResolveThreadInput) => Promise<ResolveThreadResult>
} {
  const {
    spec,
    github,
    reviewJobStore,
    feedbackStore,
    now,
  } = context

  async function withFailureRecording<T>(operation: Operation, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      context.recordFailure(operation, error)
      throw error
    }
  }

  async function recordCompletion(input: RecordCompletionInput): Promise<RecordCompletionResult> {
    return withFailureRecording('record-completion', async () => {
      const bundle = reviewJobStore.getReviewBundle(spec.bundleId)
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
      const agent = reviewJobStore
        .listReviewAgents(spec.bundleId)
        .find((candidate) => candidate.reviewType === spec.reviewType)
      if (agent === undefined) {
        throw new ReviewerFeedbackError('not-found', `Reviewer ${spec.reviewType} has no review agent record.`)
      }
      const alreadyRecorded = reconcileExistingCompletion(
        context,
        input,
        agent,
      )
      if (alreadyRecorded !== undefined) return alreadyRecorded
      if (bundle.status !== 'running' || agent.status !== 'running') {
        throw new ReviewerFeedbackError(
          'policy',
          `Cannot record completion while bundle is ${bundle.status} and reviewer is ${agent.status}.`,
        )
      }
      if (agent.providerSessionId === undefined || agent.providerRunId === undefined) {
        throw new ReviewerFeedbackError(
          'policy',
          `Reviewer ${spec.reviewType} has no provider identity recorded for completion.`,
        )
      }
      const completed = reviewJobStore.completeReviewAgent(
        spec.bundleId,
        spec.reviewType,
        {
          bundleId: spec.bundleId,
          providerSessionId: agent.providerSessionId,
          providerRunId: agent.providerRunId,
          baseRevision: bundle.baseRevision,
          headRevision: bundle.headRevision,
          exactFilesDigest: exactFilesDigest(bundle.changedFiles),
          exactFiles: bundle.changedFiles,
          reviewerDefinitionVersion: definition.version,
        },
        now(),
        recordReviewInputSchema.parse({
          verdict: input.verdict,
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          findings: input.findings,
          reviewType: spec.reviewType,
          pullRequestNumber: spec.pullRequestNumber,
          sourceState: spec.sourceState,
        }),
        spec.sourceState,
      )
      feedbackStore.recordCompletion(
        spec.bundleId,
        spec.reviewType,
        {
          verdict: input.verdict,
          satisfaction: input.satisfaction,
          reviewId: completed.review.id,
        },
        now(),
      )
      return {
        status: 'recorded' as const,
        reviewId: completed.review.id,
        agentStatus: completed.agent.status,
      }
    })
  }

  async function resolveThread(input: ResolveThreadInput): Promise<ResolveThreadResult> {
    return withFailureRecording('resolve-thread', async () => {
      if (spec.threadResolution === 'forbidden') {
        throw new ReviewerFeedbackError('policy', 'Workflow policy does not permit reviewers to resolve threads.')
      }
      const owner = feedbackStore.findThreadOwner(spec.bundleId, input.threadId)
      if (owner?.reviewType !== spec.reviewType) {
        throw new ReviewerFeedbackError(
          'policy',
          'Workflow policy only permits resolving threads owned by this reviewer.',
        )
      }
      await context.requireCurrentHead()
      const thread = await context.requireOpenThread(input.threadId)
      if (thread.isResolved) {
        feedbackStore.markThreadResolved(spec.bundleId, spec.reviewType, input.threadId, now())
        return {
          status: 'already-resolved' as const,
          threadId: input.threadId,
        }
      }
      await github.resolveThread(input.threadId)
      feedbackStore.markThreadResolved(spec.bundleId, spec.reviewType, input.threadId, now())
      return {
        status: 'resolved' as const,
        threadId: input.threadId,
      }
    })
  }

  return {
    recordCompletion,
    resolveThread,
  }
}
