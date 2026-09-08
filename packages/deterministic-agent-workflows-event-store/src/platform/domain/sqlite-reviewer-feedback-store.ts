import { z } from 'zod'
import type {
  ReviewerCompletionRecord,
  ReviewerFeedbackStore,
  ReviewerSubmissionRecord,
  ReviewerThreadOwnershipRecord,
} from './reviewer-feedback-store'
import {
  reviewerCompletionRecordSchema,
  reviewerFeedbackFailureRecordSchema,
  reviewerFeedbackFailureKindSchema,
  reviewerFeedbackOperationSchema,
  reviewerSubmissionRecordSchema,
  reviewerThreadOwnershipRecordSchema,
} from './reviewer-feedback-store'
import type { SqliteDatabase } from '../infra/external-clients/sqlite/sqlite-runtime'
import { WorkflowStateError } from '@nt-ai-lab/deterministic-agent-workflow-engine'

export const createReviewerFeedbackTablesSql = `
  CREATE TABLE IF NOT EXISTS reviewer_feedback_submissions (
    bundle_id TEXT NOT NULL,
    review_type TEXT NOT NULL,
    head_revision TEXT NOT NULL,
    github_review_id INTEGER NOT NULL,
    comment_ids_json TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    PRIMARY KEY (bundle_id, review_type)
  )
`

export const createReviewerFeedbackThreadsTableSql = `
  CREATE TABLE IF NOT EXISTS reviewer_feedback_threads (
    bundle_id TEXT NOT NULL,
    review_type TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    comment_database_id INTEGER,
    recorded_at TEXT NOT NULL,
    resolved_at TEXT,
    PRIMARY KEY (bundle_id, review_type, thread_id, comment_database_id)
  )
`

export const createReviewerFeedbackCompletionsTableSql = `
  CREATE TABLE IF NOT EXISTS reviewer_feedback_completions (
    bundle_id TEXT NOT NULL,
    review_type TEXT NOT NULL,
    verdict TEXT NOT NULL,
    satisfaction TEXT NOT NULL,
    review_id INTEGER,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (bundle_id, review_type)
  )
`

export const createReviewerFeedbackFailuresTableSql = `
  CREATE TABLE IF NOT EXISTS reviewer_feedback_failures (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    bundle_id TEXT NOT NULL,
    review_type TEXT NOT NULL,
    operation TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )
`

const submissionRowSchema = z.object({
  bundle_id: z.string(),
  review_type: z.string(),
  head_revision: z.string(),
  github_review_id: z.number(),
  comment_ids_json: z.string(),
  submitted_at: z.string(),
})

const threadRowSchema = z.object({
  bundle_id: z.string(),
  review_type: z.string(),
  thread_id: z.string(),
  comment_database_id: z.number().nullable(),
  recorded_at: z.string(),
  resolved_at: z.string().nullable(),
})

const completionRowSchema = z.object({
  bundle_id: z.string(),
  review_type: z.string(),
  verdict: z.string(),
  satisfaction: z.string(),
  review_id: z.number().nullable(),
  recorded_at: z.string(),
})

const failureRowSchema = z.object({
  bundle_id: z.string(),
  review_type: z.string(),
  operation: z.string(),
  kind: z.string(),
  message: z.string(),
  recorded_at: z.string(),
})

function parseSubmission(row: unknown): ReviewerSubmissionRecord {
  const parsed = submissionRowSchema.parse(row)
  return reviewerSubmissionRecordSchema.parse({
    bundleId: parsed.bundle_id,
    reviewType: parsed.review_type,
    headRevision: parsed.head_revision,
    githubReviewId: parsed.github_review_id,
    commentIds: z.array(z.number()).parse(JSON.parse(parsed.comment_ids_json)),
    submittedAt: parsed.submitted_at,
  })
}

function parseThread(row: unknown): ReviewerThreadOwnershipRecord {
  const parsed = threadRowSchema.parse(row)
  return reviewerThreadOwnershipRecordSchema.parse({
    bundleId: parsed.bundle_id,
    reviewType: parsed.review_type,
    threadId: parsed.thread_id,
    recordedAt: parsed.recorded_at,
    ...(parsed.comment_database_id === null ? {} : { commentDatabaseId: parsed.comment_database_id }),
    ...(parsed.resolved_at === null ? {} : { resolvedAt: parsed.resolved_at }),
  })
}

function parseCompletion(row: unknown): ReviewerCompletionRecord {
  const parsed = completionRowSchema.parse(row)
  return reviewerCompletionRecordSchema.parse({
    bundleId: parsed.bundle_id,
    reviewType: parsed.review_type,
    verdict: parsed.verdict,
    satisfaction: parsed.satisfaction,
    recordedAt: parsed.recorded_at,
    ...(parsed.review_id === null ? {} : { reviewId: parsed.review_id }),
  })
}

function parseFailure(row: unknown) {
  const parsed = failureRowSchema.parse(row)
  return reviewerFeedbackFailureRecordSchema.parse({
    bundleId: parsed.bundle_id,
    reviewType: parsed.review_type,
    operation: reviewerFeedbackOperationSchema.parse(parsed.operation),
    kind: reviewerFeedbackFailureKindSchema.parse(parsed.kind),
    message: parsed.message,
    recordedAt: parsed.recorded_at,
  })
}

/** @riviere-role domain-service */
export function createSqliteReviewerFeedbackStore(db: SqliteDatabase): ReviewerFeedbackStore {
  return {
    findSubmission(bundleId, reviewType) {
      const row = db.prepare(
        'SELECT * FROM reviewer_feedback_submissions WHERE bundle_id = ? AND review_type = ?',
      ).get(bundleId, reviewType)
      return row === undefined ? undefined : parseSubmission(row)
    },
    recordSubmission(bundleId, reviewType, submission, submittedAt) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const insert = db.prepare(`
          INSERT OR IGNORE INTO reviewer_feedback_submissions (
            bundle_id, review_type, head_revision, github_review_id, comment_ids_json, submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        insert.run(
          bundleId,
          reviewType,
          submission.headRevision,
          submission.githubReviewId,
          JSON.stringify([...submission.commentIds]),
          submittedAt,
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const stored = this.findSubmission(bundleId, reviewType)
      if (stored === undefined) {
        throw new WorkflowStateError(`Reviewer submission for ${reviewType} in bundle ${bundleId} could not be stored.`)
      }
      return stored
    },
    recordThreadOwnership(bundleId, reviewType, thread, recordedAt) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`
          INSERT OR IGNORE INTO reviewer_feedback_threads (
            bundle_id, review_type, thread_id, comment_database_id, recorded_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          bundleId,
          reviewType,
          thread.threadId,
          thread.commentDatabaseId ?? null,
          recordedAt,
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    listThreadOwnership(bundleId, reviewType) {
      const rows = reviewType === undefined
        ? db.prepare(
          'SELECT * FROM reviewer_feedback_threads WHERE bundle_id = ? ORDER BY recorded_at, thread_id',
        ).all(bundleId)
        : db.prepare(`
            SELECT * FROM reviewer_feedback_threads
            WHERE bundle_id = ? AND review_type = ?
            ORDER BY recorded_at, thread_id
          `).all(bundleId, reviewType)
      return z.array(threadRowSchema).parse(rows).map(parseThread)
    },
    findThreadOwner(bundleId, threadId) {
      const row = db.prepare(`
        SELECT * FROM reviewer_feedback_threads
        WHERE bundle_id = ? AND thread_id = ?
        ORDER BY recorded_at
        LIMIT 1
      `).get(bundleId, threadId)
      return row === undefined ? undefined : parseThread(row)
    },
    markThreadResolved(bundleId, reviewType, threadId, resolvedAt) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result: unknown = db.prepare(`
          UPDATE reviewer_feedback_threads SET resolved_at = ?
          WHERE bundle_id = ? AND review_type = ? AND thread_id = ? AND resolved_at IS NULL
        `).run(resolvedAt, bundleId, reviewType, threadId)
        const changes = z.object({ changes: z.number() }).passthrough().parse(result).changes
        if (changes === 0) {
          throw new WorkflowStateError(
            `Thread ${threadId} is not owned by reviewer ${reviewType} in bundle ${bundleId}.`,
          )
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    findCompletion(bundleId, reviewType) {
      const row = db.prepare(
        'SELECT * FROM reviewer_feedback_completions WHERE bundle_id = ? AND review_type = ?',
      ).get(bundleId, reviewType)
      return row === undefined ? undefined : parseCompletion(row)
    },
    recordCompletion(bundleId, reviewType, completion, recordedAt) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`
          INSERT OR IGNORE INTO reviewer_feedback_completions (
            bundle_id, review_type, verdict, satisfaction, review_id, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          bundleId,
          reviewType,
          completion.verdict,
          completion.satisfaction,
          completion.reviewId ?? null,
          recordedAt,
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const stored = this.findCompletion(bundleId, reviewType)
      if (stored === undefined) {
        throw new WorkflowStateError(`Reviewer completion for ${reviewType} in bundle ${bundleId} could not be stored.`)
      }
      return stored
    },
    recordFailure(bundleId, reviewType, failure, recordedAt) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`
          INSERT INTO reviewer_feedback_failures (
            bundle_id, review_type, operation, kind, message, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(bundleId, reviewType, failure.operation, failure.kind, failure.message, recordedAt)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    listFailures(bundleId, reviewType) {
      const rows = reviewType === undefined
        ? db.prepare(
          'SELECT * FROM reviewer_feedback_failures WHERE bundle_id = ? ORDER BY seq',
        ).all(bundleId)
        : db.prepare(`
            SELECT * FROM reviewer_feedback_failures
            WHERE bundle_id = ? AND review_type = ?
            ORDER BY seq
          `).all(bundleId, reviewType)
      return z.array(failureRowSchema).parse(rows).map(parseFailure)
    },
  }
}
