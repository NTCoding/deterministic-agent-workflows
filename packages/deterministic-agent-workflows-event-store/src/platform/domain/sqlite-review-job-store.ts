import { z } from 'zod'
import type {
  RecordReviewInput,
  ReviewBundleRequest,
  ReviewJobStore,
  StoredReview,
  StoredReviewAgent,
  ReviewCompletionProvenance,
  StoredReviewBundle,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  reviewBundleRequestSchema,
  storedReviewAgentSchema,
  storedReviewBundleSchema,
  WorkflowStateError,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { SqliteDatabase } from '../infra/external-clients/sqlite/sqlite-runtime'
import { updateReviewBundleLifecycle } from './sqlite-review-bundle-lifecycle'
import { completeReviewAgentTransaction } from './sqlite-review-agent-completion'

export const createReviewBundlesTableSql = `
  CREATE TABLE IF NOT EXISTS review_bundles (
    bundle_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL,
    base_revision TEXT NOT NULL,
    head_revision TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    failure_reason TEXT,
    request_json TEXT NOT NULL
  )
`

export const createActiveReviewBundleIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_review_bundles_one_active_pr
  ON review_bundles (repository, pull_request_number)
  WHERE status IN ('requested', 'running')
`

export const createReviewAgentsTableSql = `
  CREATE TABLE IF NOT EXISTS review_agents (
    bundle_id TEXT NOT NULL,
    review_type TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_session_id TEXT,
    provider_run_id TEXT,
    review_id INTEGER,
    completion_provenance_json TEXT,
    failure_reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bundle_id, review_type),
    FOREIGN KEY (bundle_id) REFERENCES review_bundles(bundle_id)
  )
`

const reviewBundleRowSchema = z.object({
  bundle_id: z.string(),
  session_id: z.string(),
  repository: z.string(),
  pull_request_number: z.number(),
  base_revision: z.string(),
  head_revision: z.string(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  failure_reason: z.string().nullable(),
  request_json: z.string(),
})

const reviewAgentRowSchema = z.object({
  bundle_id: z.string(),
  review_type: z.string(),
  status: z.string(),
  provider_session_id: z.string().nullable(),
  provider_run_id: z.string().nullable(),
  review_id: z.number().nullable(),
  completion_provenance_json: z.string().nullable(),
  failure_reason: z.string().nullable(),
  updated_at: z.string(),
})

function parseReviewBundle(row: unknown): StoredReviewBundle {
  const parsed = reviewBundleRowSchema.parse(row)
  const request = reviewBundleRequestSchema.parse(JSON.parse(parsed.request_json))
  return storedReviewBundleSchema.parse({
    ...request,
    status: parsed.status,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    ...(parsed.failure_reason === null ? {} : { failureReason: parsed.failure_reason }),
  })
}

function parseReviewAgent(row: unknown): StoredReviewAgent {
  const parsed = reviewAgentRowSchema.parse(row)
  const completionProvenance: unknown = parsed.completion_provenance_json === null
    ? undefined
    : JSON.parse(parsed.completion_provenance_json)
  return storedReviewAgentSchema.parse({
    bundleId: parsed.bundle_id,
    reviewType: parsed.review_type,
    status: parsed.status,
    updatedAt: parsed.updated_at,
    ...(parsed.provider_session_id === null
      ? {}
      : { providerSessionId: parsed.provider_session_id }),
    ...(parsed.provider_run_id === null ? {} : { providerRunId: parsed.provider_run_id }),
    ...(parsed.review_id === null ? {} : { reviewId: parsed.review_id }),
    ...(completionProvenance === undefined ? {} : { completionProvenance }),
    ...(parsed.failure_reason === null ? {} : { failureReason: parsed.failure_reason }),
  })
}

function requireReviewBundle(db: SqliteDatabase, bundleId: string): StoredReviewBundle {
  const row = db.prepare('SELECT * FROM review_bundles WHERE bundle_id = ?').get(bundleId)
  if (row === undefined) throw new WorkflowStateError(`Review bundle ${bundleId} not found.`)
  return parseReviewBundle(row)
}

function requireReviewAgent(
  db: SqliteDatabase,
  bundleId: string,
  reviewType: string,
): StoredReviewAgent {
  const row = db.prepare(
    'SELECT * FROM review_agents WHERE bundle_id = ? AND review_type = ?',
  ).get(bundleId, reviewType)
  if (row === undefined) {
    throw new WorkflowStateError(`Review agent ${reviewType} not found in bundle ${bundleId}.`)
  }
  return parseReviewAgent(row)
}

function appendPlatformEvent(
  db: SqliteDatabase,
  sessionId: string,
  type: string,
  at: string,
  state: string | null,
  payload: Readonly<Record<string, unknown>>,
): void {
  db.prepare(
    'INSERT INTO events (session_id, type, at, state, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, type, at, state, JSON.stringify(payload))
}

function updateBundleStatus(
  db: SqliteDatabase,
  bundleId: string,
  status: StoredReviewBundle['status'],
  updatedAt: string,
  eventType: 'review-bundle-started' | 'review-bundle-completed' | 'review-bundle-failed' | 'review-bundle-cancelled',
  reason?: string,
): StoredReviewBundle {
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = requireReviewBundle(db, bundleId)
    updateReviewBundleLifecycle(db, current, status, updatedAt, eventType, reason)
    db.exec('COMMIT')
    return requireReviewBundle(db, bundleId)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** @riviere-role domain-service */
export function createSqliteReviewJobStore(db: SqliteDatabase): ReviewJobStore {
  return {
    claimReviewBundle(input: ReviewBundleRequest, createdAt: string): StoredReviewBundle {
      const parsed = reviewBundleRequestSchema.parse(input)
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`
          INSERT INTO review_bundles (
            bundle_id, session_id, repository, pull_request_number, base_revision,
            head_revision, status, created_at, updated_at, request_json
          ) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)
        `).run(
          parsed.bundleId,
          parsed.sessionId,
          parsed.repository,
          parsed.pullRequestNumber,
          parsed.baseRevision,
          parsed.headRevision,
          createdAt,
          createdAt,
          JSON.stringify(parsed),
        )
        appendPlatformEvent(
          db,
          parsed.sessionId,
          'review-bundle-requested',
          createdAt,
          null,
          {
            bundleId: parsed.bundleId,
            repository: parsed.repository,
            pullRequestNumber: parsed.pullRequestNumber,
            headRevision: parsed.headRevision,
          },
        )
        const insertAgent = db.prepare(`
          INSERT INTO review_agents (bundle_id, review_type, status, updated_at)
          VALUES (?, ?, 'requested', ?)
        `)
        for (const review of parsed.reviews) {
          insertAgent.run(parsed.bundleId, review.reviewType, createdAt)
          appendPlatformEvent(
            db,
            parsed.sessionId,
            'review-agent-requested',
            createdAt,
            null,
            {
              bundleId: parsed.bundleId,
              reviewType: review.reviewType,
            },
          )
        }
        db.exec('COMMIT')
        return requireReviewBundle(db, parsed.bundleId)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    getReviewBundle(bundleId: string): StoredReviewBundle | undefined {
      const row = db.prepare('SELECT * FROM review_bundles WHERE bundle_id = ?').get(bundleId)
      return row === undefined ? undefined : parseReviewBundle(row)
    },
    findActiveReviewBundle(
      repository: string,
      pullRequestNumber: number,
    ): StoredReviewBundle | undefined {
      const row = db.prepare(`
        SELECT * FROM review_bundles
        WHERE repository = ? AND pull_request_number = ? AND status IN ('requested', 'running')
      `).get(repository, pullRequestNumber)
      return row === undefined ? undefined : parseReviewBundle(row)
    },
    listReviewAgents(bundleId: string): readonly StoredReviewAgent[] {
      return db.prepare(
        'SELECT * FROM review_agents WHERE bundle_id = ? ORDER BY review_type',
      ).all(bundleId).map(parseReviewAgent)
    },
    markReviewBundleRunning(bundleId: string, updatedAt: string): StoredReviewBundle {
      return updateBundleStatus(
        db,
        bundleId,
        'running',
        updatedAt,
        'review-bundle-started',
      )
    },
    markReviewAgentRunning(
      bundleId: string,
      reviewType: string,
      providerSessionId: string,
      providerRunId: string,
      updatedAt: string,
    ): StoredReviewAgent {
      db.exec('BEGIN IMMEDIATE')
      try {
        const bundle = requireReviewBundle(db, bundleId)
        const agent = requireReviewAgent(db, bundleId, reviewType)
        if (bundle.status !== 'running' || agent.status !== 'requested') {
          throw new WorkflowStateError(
            `Review agent ${reviewType} cannot start while bundle is ${bundle.status} and agent is ${agent.status}.`,
          )
        }
        db.prepare(`
          UPDATE review_agents
          SET status = 'running', provider_session_id = ?, provider_run_id = ?, updated_at = ?
          WHERE bundle_id = ? AND review_type = ? AND status = 'requested'
        `).run(providerSessionId, providerRunId, updatedAt, bundleId, reviewType)
        appendPlatformEvent(db, bundle.sessionId, 'review-agent-started', updatedAt, null, {
          bundleId,
          reviewType,
          providerSessionId,
          providerRunId,
        })
        db.exec('COMMIT')
        return requireReviewAgent(db, bundleId, reviewType)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    resumeReviewAgent(
      bundleId: string,
      reviewType: string,
      providerSessionId: string,
      providerRunId: string,
      updatedAt: string,
    ): StoredReviewAgent {
      db.exec('BEGIN IMMEDIATE')
      try {
        const bundle = requireReviewBundle(db, bundleId)
        const agent = requireReviewAgent(db, bundleId, reviewType)
        if (bundle.status !== 'running' || agent.status !== 'running' ||
          agent.providerSessionId !== providerSessionId) {
          throw new WorkflowStateError(
            `Review agent ${reviewType} cannot resume with provider session ${providerSessionId}.`,
          )
        }
        db.prepare(`
          UPDATE review_agents SET provider_run_id = ?, updated_at = ?
          WHERE bundle_id = ? AND review_type = ? AND status = 'running'
            AND provider_session_id = ?
        `).run(providerRunId, updatedAt, bundleId, reviewType, providerSessionId)
        db.exec('COMMIT')
        return requireReviewAgent(db, bundleId, reviewType)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    completeReviewAgent(
      bundleId: string,
      reviewType: string,
      provenance: ReviewCompletionProvenance,
      createdAt: string,
      input: RecordReviewInput,
      eventState: string,
    ): {
        readonly agent: StoredReviewAgent;
        readonly review: StoredReview
      } {
      return completeReviewAgentTransaction({
        db,
        requireBundle: (id) => requireReviewBundle(db, id),
        requireAgent: (id, type) => requireReviewAgent(db, id, type),
        appendEvent: (sessionId, type, at, state, payload) =>
          appendPlatformEvent(db, sessionId, type, at, state, payload),
      }, bundleId, reviewType, provenance, createdAt, input, eventState)
    },
    completeReviewBundle(bundleId: string, updatedAt: string): StoredReviewBundle {
      db.exec('BEGIN IMMEDIATE')
      try {
        const bundle = requireReviewBundle(db, bundleId)
        const agents = db.prepare(
          'SELECT * FROM review_agents WHERE bundle_id = ? ORDER BY review_type',
        ).all(bundleId).map(parseReviewAgent)
        if (bundle.status !== 'running' || agents.length !== bundle.reviews.length ||
          agents.some((agent) => agent.status !== 'completed')) {
          throw new WorkflowStateError(
            `Cannot complete review bundle ${bundleId} from ${bundle.status} before every reviewer completes.`,
          )
        }
        updateReviewBundleLifecycle(
          db,
          bundle,
          'completed',
          updatedAt,
          'review-bundle-completed',
        )
        db.exec('COMMIT')
        return requireReviewBundle(db, bundleId)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    failReviewBundle(bundleId: string, reason: string, updatedAt: string): StoredReviewBundle {
      return updateBundleStatus(db, bundleId, 'failed', updatedAt, 'review-bundle-failed', reason)
    },
    cancelReviewBundle(bundleId: string, reason: string, updatedAt: string): StoredReviewBundle {
      return updateBundleStatus(
        db,
        bundleId,
        'cancelled',
        updatedAt,
        'review-bundle-cancelled',
        reason,
      )
    },
  }
}
