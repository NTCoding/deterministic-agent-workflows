import { z } from 'zod'
import {
  WorkflowStateError,
  type StoredReviewBundle,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { SqliteDatabase } from '../infra/external-clients/sqlite/sqlite-runtime'

const activeAgentRowSchema = z.object({
  review_type: z.string(),
  provider_session_id: z.string().nullable(),
})

type BundleLifecycleEvent =
  | 'review-bundle-started'
  | 'review-bundle-completed'
  | 'review-bundle-failed'
  | 'review-bundle-cancelled'

function appendLifecycleEvent(
  db: SqliteDatabase,
  sessionId: string,
  type: string,
  at: string,
  payload: Readonly<Record<string, unknown>>,
): void {
  db.prepare(
    'INSERT INTO events (session_id, type, at, state, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, type, at, null, JSON.stringify(payload))
}

/** @riviere-role domain-service */
export function updateReviewBundleLifecycle(
  db: SqliteDatabase,
  current: StoredReviewBundle,
  status: StoredReviewBundle['status'],
  updatedAt: string,
  eventType: BundleLifecycleEvent,
  reason?: string,
): void {
  if (!isTransitionAllowed(current.status, status)) {
    throw new WorkflowStateError(
      `Review bundle ${current.bundleId} cannot transition from ${current.status} to ${status}.`,
    )
  }
  if (eventType === 'review-bundle-failed' || eventType === 'review-bundle-cancelled') {
    terminateActiveAgents(db, current, updatedAt, eventType, reason)
  }
  db.prepare(`
    UPDATE review_bundles SET status = ?, updated_at = ?, failure_reason = ?
    WHERE bundle_id = ? AND status = ?
  `).run(status, updatedAt, reason ?? null, current.bundleId, current.status)
  appendLifecycleEvent(db, current.sessionId, eventType, updatedAt, {
    bundleId: current.bundleId,
    ...((eventType === 'review-bundle-failed' || eventType === 'review-bundle-cancelled')
      ? { reason }
      : {}),
  })
}

function isTransitionAllowed(
  current: StoredReviewBundle['status'],
  next: StoredReviewBundle['status'],
): boolean {
  if (current === 'requested') return next === 'running' || next === 'failed' || next === 'cancelled'
  return current === 'running' && (next === 'completed' || next === 'failed' || next === 'cancelled')
}

function terminateActiveAgents(
  db: SqliteDatabase,
  current: StoredReviewBundle,
  updatedAt: string,
  eventType: 'review-bundle-failed' | 'review-bundle-cancelled',
  reason?: string,
): void {
  const activeAgents = db.prepare(`
    SELECT review_type, provider_session_id
    FROM review_agents
    WHERE bundle_id = ? AND status IN ('requested', 'running')
  `).all(current.bundleId).map((row) => activeAgentRowSchema.parse(row))
  const agentStatus = eventType === 'review-bundle-failed' ? 'failed' : 'cancelled'
  for (const agent of activeAgents) {
    db.prepare(`
      UPDATE review_agents
      SET status = ?, updated_at = ?, failure_reason = ?
      WHERE bundle_id = ? AND review_type = ?
    `).run(agentStatus, updatedAt, reason ?? null, current.bundleId, agent.review_type)
    appendLifecycleEvent(
      db,
      current.sessionId,
      eventType === 'review-bundle-failed'
        ? 'review-agent-failed'
        : 'review-agent-cancelled',
      updatedAt,
      {
        bundleId: current.bundleId,
        reviewType: agent.review_type,
        ...(agent.provider_session_id === null
          ? {}
          : { providerSessionId: agent.provider_session_id }),
        reason,
      },
    )
  }
}
