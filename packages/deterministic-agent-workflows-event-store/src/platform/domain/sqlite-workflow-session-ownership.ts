import { z } from 'zod'
import { WorkflowStateError } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { SqliteDatabase } from '../infra/external-clients/sqlite/sqlite-runtime'

const countRowSchema = z.object({ count: z.union([z.number(), z.bigint(), z.string()]) })
const workflowOwnerRowSchema = z.object({
  workflow_session_id: z.string(),
  owner_session_id: z.string(),
})

/** @riviere-role value-object */
export interface SqliteWorkflowSessionOwnership {
  requireWorkflowSessionAccess(
    executingSessionId: string,
    delegatedParentSessionId?: string,
  ): string
  transferWorkflowSessionOwnership(
    previousOwnerSessionId: string,
    ownerSessionId: string,
    at: string,
  ): void
}

/** @riviere-role domain-service */
export function initializeWorkflowSessionOwnership(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_session_owners (
      workflow_session_id TEXT PRIMARY KEY,
      owner_session_id TEXT NOT NULL UNIQUE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_session_aliases (
      session_id TEXT PRIMARY KEY,
      workflow_session_id TEXT NOT NULL,
      FOREIGN KEY (workflow_session_id) REFERENCES workflow_session_owners(workflow_session_id)
    )
  `)
}

/** @riviere-role domain-service */
export function resolveWorkflowSessionAlias(db: SqliteDatabase, sessionId: string): string {
  return readWorkflowOwner(db, sessionId)?.workflow_session_id ?? sessionId
}

/** @riviere-role domain-service */
export function registerWorkflowSessionOwner(
  db: SqliteDatabase,
  workflowSessionId: string,
  ownerSessionId: string,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO workflow_session_owners (workflow_session_id, owner_session_id)
    VALUES (?, ?)
  `).run(workflowSessionId, ownerSessionId)
  db.prepare(`
    INSERT OR IGNORE INTO workflow_session_aliases (session_id, workflow_session_id)
    VALUES (?, ?)
  `).run(ownerSessionId, workflowSessionId)
}

/** @riviere-role domain-service */
export function createSqliteWorkflowSessionOwnership(
  db: SqliteDatabase,
): SqliteWorkflowSessionOwnership {
  return {
    requireWorkflowSessionAccess(
      executingSessionId: string,
      delegatedParentSessionId?: string,
    ): string {
      const accessSessionId = delegatedParentSessionId ?? executingSessionId
      const owner = readWorkflowOwner(db, accessSessionId)
      if (owner !== undefined) {
        if (owner.owner_session_id !== accessSessionId) {
          throw new WorkflowStateError(
            `Pi session ${accessSessionId} is not the current workflow owner; owner is ${owner.owner_session_id}.`,
          )
        }
        return owner.workflow_session_id
      }
      if (!hasStartedEvent(db, accessSessionId)) {
        const relationship = delegatedParentSessionId === undefined ? 'session' : 'parent session'
        throw new WorkflowStateError(`Pi ${relationship} ${accessSessionId} has no persisted workflow.`)
      }
      return accessSessionId
    },
    transferWorkflowSessionOwnership(
      previousOwnerSessionId: string,
      ownerSessionId: string,
      at: string,
    ): void {
      transferWorkflowSessionOwnership(db, previousOwnerSessionId, ownerSessionId, at)
    },
  }
}

function transferWorkflowSessionOwnership(
  db: SqliteDatabase,
  rawPrevious: string,
  rawNext: string,
  at: string,
): void {
  const previous = rawPrevious.trim()
  const next = rawNext.trim()
  if (previous.length === 0 || next.length === 0) {
    throw new WorkflowStateError('Pi workflow ownership session UUIDs must not be empty.')
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = readWorkflowOwner(db, previous)
    const workflowSessionId = existing?.workflow_session_id ?? previous
    if (existing !== undefined && existing.owner_session_id !== previous) {
      throw new WorkflowStateError(`Pi session ${previous} is not the current workflow owner.`)
    }
    if (!hasStartedEvent(db, workflowSessionId)) {
      throw new WorkflowStateError(`Pi session ${previous} has no persisted workflow.`)
    }
    if (readWorkflowOwner(db, next) !== undefined || db.prepare(
      'SELECT 1 AS count FROM events WHERE session_id = ? LIMIT 1',
    ).get(next) !== undefined) {
      throw new WorkflowStateError(`Pi session ${next} already belongs to a workflow.`)
    }
    registerWorkflowSessionOwner(db, workflowSessionId, previous)
    db.prepare(`
      INSERT INTO workflow_session_aliases (session_id, workflow_session_id) VALUES (?, ?)
    `).run(next, workflowSessionId)
    db.prepare(`
      UPDATE workflow_session_owners SET owner_session_id = ?
      WHERE workflow_session_id = ? AND owner_session_id = ?
    `).run(next, workflowSessionId, previous)
    db.prepare(
      'INSERT INTO events (session_id, type, at, state, payload) VALUES (?, ?, ?, ?, ?)',
    ).run(workflowSessionId, 'workflow-session-owner-transferred', at, null, JSON.stringify({
      previousOwnerSessionId: previous,
      ownerSessionId: next,
    }))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function readWorkflowOwner(
  db: SqliteDatabase,
  sessionId: string,
): z.infer<typeof workflowOwnerRowSchema> | undefined {
  const row = db.prepare(`
    SELECT aliases.workflow_session_id, owners.owner_session_id
    FROM workflow_session_aliases aliases
    JOIN workflow_session_owners owners
      ON owners.workflow_session_id = aliases.workflow_session_id
    WHERE aliases.session_id = ?
  `).get(sessionId)
  return row === undefined ? undefined : workflowOwnerRowSchema.parse(row)
}

function hasStartedEvent(db: SqliteDatabase, sessionId: string): boolean {
  const row = countRowSchema.parse(db.prepare(`
    SELECT COUNT(1) AS count FROM events WHERE session_id = ? AND type = 'session-started'
  `).get(sessionId))
  return Number(row.count) > 0
}
