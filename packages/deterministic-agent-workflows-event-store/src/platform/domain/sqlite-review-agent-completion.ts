import { createHash } from 'node:crypto'
import type {
  RecordReviewInput,
  ReviewCompletionProvenance,
  StoredReview,
  StoredReviewAgent,
  StoredReviewBundle,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  recordReviewInputSchema,
  reviewCompletionProvenanceSchema,
  storedReviewSchema,
  WorkflowStateError,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { SqliteDatabase } from '../infra/external-clients/sqlite/sqlite-runtime'
import { reviewIdRowSchema } from './sqlite-review-storage'

/** @riviere-role value-object */
export interface ReviewCompletionTransactionDeps {
  readonly db: SqliteDatabase
  readonly requireBundle: (bundleId: string) => StoredReviewBundle
  readonly requireAgent: (bundleId: string, reviewType: string) => StoredReviewAgent
  readonly appendEvent: (
    sessionId: string,
    type: string,
    at: string,
    state: string | null,
    payload: Readonly<Record<string, unknown>>,
  ) => void
}

/** @riviere-role domain-service */
export function completeReviewAgentTransaction(
  deps: ReviewCompletionTransactionDeps,
  bundleId: string,
  reviewType: string,
  rawProvenance: ReviewCompletionProvenance,
  createdAt: string,
  input: RecordReviewInput,
  eventState: string,
): {
    readonly agent: StoredReviewAgent;
    readonly review: StoredReview 
  } {
  const parsedInput = recordReviewInputSchema.parse(input)
  const provenance = reviewCompletionProvenanceSchema.parse(rawProvenance)
  if (parsedInput.reviewType !== reviewType) {
    throw new WorkflowStateError(
      `Review result type ${parsedInput.reviewType} does not match ${reviewType}.`,
    )
  }
  deps.db.exec('BEGIN IMMEDIATE')
  try {
    const bundle = deps.requireBundle(bundleId)
    const agent = deps.requireAgent(bundleId, reviewType)
    validateProvenance(bundle, reviewType, provenance)
    validateActiveRun(bundle, agent, reviewType, provenance)
    deps.db.prepare(`
      INSERT INTO reviews (
        session_id, created_at, review_type, verdict, branch,
        pull_request_number, source_state, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bundle.sessionId,
      createdAt,
      parsedInput.reviewType,
      parsedInput.verdict,
      parsedInput.branch ?? null,
      parsedInput.pullRequestNumber ?? null,
      parsedInput.sourceState ?? null,
      JSON.stringify({
        ...parsedInput,
        completionProvenance: provenance 
      }),
    )
    const id = Number(reviewIdRowSchema.parse(
      deps.db.prepare('SELECT last_insert_rowid() AS id').get(),
    ).id)
    deps.db.prepare(`
      UPDATE review_agents
      SET status = 'completed', review_id = ?, completion_provenance_json = ?, updated_at = ?
      WHERE bundle_id = ? AND review_type = ? AND status = 'running'
        AND provider_session_id = ? AND provider_run_id = ?
    `).run(
      id,
      JSON.stringify(provenance),
      createdAt,
      bundleId,
      reviewType,
      provenance.providerSessionId,
      provenance.providerRunId,
    )
    deps.appendEvent(bundle.sessionId, 'review-recorded', createdAt, eventState, {
      reviewId: id,
      reviewType,
      verdict: parsedInput.verdict,
    })
    deps.appendEvent(bundle.sessionId, 'review-agent-completed', createdAt, eventState, {
      ...provenance,
      reviewType,
      reviewId: id,
      verdict: parsedInput.verdict,
    })
    deps.db.exec('COMMIT')
    return {
      agent: deps.requireAgent(bundleId, reviewType),
      review: storedReviewSchema.parse({
        id,
        sessionId: bundle.sessionId,
        createdAt,
        ...parsedInput,
      }),
    }
  } catch (error) {
    deps.db.exec('ROLLBACK')
    throw error
  }
}

function validateProvenance(
  bundle: StoredReviewBundle,
  reviewType: string,
  provenance: ReviewCompletionProvenance,
): void {
  const definition = bundle.reviews.find((review) => review.reviewType === reviewType)
  const digest = createHash('sha256').update(JSON.stringify(bundle.changedFiles)).digest('hex')
  const valid = definition !== undefined && provenance.bundleId === bundle.bundleId &&
    provenance.baseRevision === bundle.baseRevision &&
    provenance.headRevision === bundle.headRevision &&
    JSON.stringify(provenance.exactFiles) === JSON.stringify(bundle.changedFiles) &&
    provenance.exactFilesDigest === digest &&
    provenance.reviewerDefinitionVersion === definition.version
  if (!valid) {
    throw new WorkflowStateError(
      `Review completion provenance does not match bundle ${bundle.bundleId} reviewer ${reviewType}.`,
    )
  }
}

function validateActiveRun(
  bundle: StoredReviewBundle,
  agent: StoredReviewAgent,
  reviewType: string,
  provenance: ReviewCompletionProvenance,
): void {
  if (bundle.status !== 'running' || agent.status !== 'running') {
    throw new WorkflowStateError(
      `Review agent ${reviewType} cannot complete while bundle is ${bundle.status} and agent is ${agent.status}.`,
    )
  }
  if (agent.providerSessionId !== provenance.providerSessionId ||
    agent.providerRunId !== provenance.providerRunId) {
    throw new WorkflowStateError(
      `Review agent ${reviewType} completion provider session or run does not match the active run.`,
    )
  }
}
