import type {
  ReviewerFeedbackService,
  ReviewerFeedbackServiceDeps,
} from './reviewer-feedback-contracts'
import { createReviewerOperationContext } from './reviewer-feedback-contracts'
import { createReviewerFeedbackReadWrite } from './reviewer-feedback-read-write'
import { createReviewerResolution } from './reviewer-review-resolution'

export type {
  ReviewContextResult,
  RecordCompletionResult,
  ReplyToThreadResult,
  ResolveThreadResult,
  ReviewerFeedbackService,
  ReviewerFeedbackServiceDeps,
  SubmitReviewResult,
} from './reviewer-feedback-contracts'
export type { ReviewerFeedbackServerSpec } from './reviewer-feedback-types'

/** @riviere-role domain-service */
export function createReviewerFeedbackService(deps: ReviewerFeedbackServiceDeps): ReviewerFeedbackService {
  const context = createReviewerOperationContext(deps)
  return {
    ...createReviewerFeedbackReadWrite(context),
    ...createReviewerResolution(context),
  }
}
