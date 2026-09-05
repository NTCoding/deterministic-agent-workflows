import { z } from 'zod'
import type { SqliteDatabase } from '../infra/external-clients/sqlite/sqlite-runtime'
import {
  createActiveReviewBundleIndexSql,
  createReviewAgentsTableSql,
  createReviewBundlesTableSql,
} from './sqlite-review-job-store'
import {
  createReviewsBranchIndexSql,
  createReviewsPullRequestIndexSql,
  createReviewsSessionIndexSql,
  createReviewsTableSql,
  createReviewsTypeVerdictIndexSql,
} from './sqlite-review-storage'
import { initializeWorkflowSessionOwnership } from './sqlite-workflow-session-ownership'

const tableInfoRowSchema = z.array(z.object({ name: z.string() }))

/** @riviere-role domain-service */
export function initializeEventStoreSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      state TEXT,
      payload TEXT NOT NULL
    )
  `)
  initializeWorkflowSessionOwnership(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      label TEXT,
      agent_name TEXT,
      source_state TEXT,
      payload_json TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reflections_session_created_at
    ON reflections (session_id, created_at DESC, id DESC)
  `)
  db.exec(createReviewsTableSql)
  db.exec(createReviewsSessionIndexSql)
  db.exec(createReviewsTypeVerdictIndexSql)
  db.exec(createReviewsBranchIndexSql)
  db.exec(createReviewsPullRequestIndexSql)
  db.exec(createReviewBundlesTableSql)
  db.exec(createActiveReviewBundleIndexSql)
  db.exec(createReviewAgentsTableSql)
  ensureColumn(db, 'events', 'state', 'TEXT')
  ensureColumn(db, 'review_agents', 'provider_run_id', 'TEXT')
  ensureColumn(db, 'review_agents', 'completion_provenance_json', 'TEXT')
}

function ensureColumn(
  db: SqliteDatabase,
  table: string,
  column: string,
  declaration: string,
): void {
  const columns = tableInfoRowSchema.parse(db.prepare(`PRAGMA table_info(${table})`).all())
  if (!columns.some((candidate) => candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
  }
}
