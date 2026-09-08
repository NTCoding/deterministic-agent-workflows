import type {
  ExtensionContext,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import { z } from 'zod'
import {
  createStore,
  type SqliteEventStore,
} from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { resolvePiMainSessionId } from '../../../platform/domain/pi-main-session'
import { readPiSessionMetadata } from '../../../platform/infra/external-clients/pi/pi-session-file'

interface PiWorkflowSessionOwnership {
  delegatedParent(sessionId: string, store?: SqliteEventStore): string | undefined
  contextPredecessor(sessionId: string, store?: SqliteEventStore): string | undefined
  resolveWorkflowSessionId(sessionId: string, store?: SqliteEventStore): string
  recordContextSuccessor(successorSessionId: string, retiredSessionId: string, recordedAt: string): void
  hasPersistedWorkflow(sessionId: string): boolean
  usesInheritedWorkflow(sessionId: string): boolean
  parentSafetyFailure(event: SessionStartEvent, ctx: ExtensionContext): string | undefined
  requireAccess(store: SqliteEventStore, sessionId: string): void
}

const createSuccessorsTableSql = `
  CREATE TABLE IF NOT EXISTS pi_context_successors (
    successor_session_id TEXT PRIMARY KEY,
    retired_session_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )
`

const retiredSessionRowSchema = z.object({ retired_session_id: z.string().trim().min(1) })

/** @riviere-role cli-entrypoint */
export function createPiWorkflowSessionOwnership(databasePath: string): PiWorkflowSessionOwnership {
  const withDatabase = <T>(existingStore: SqliteEventStore | undefined, operation: (store: SqliteEventStore) => T): T => {
    const store = existingStore ?? createStore(databasePath)
    try {
      return operation(store)
    } finally {
      if (existingStore === undefined) store.db.close()
    }
  }
  const delegatedParent = (sessionId: string, existingStore?: SqliteEventStore): string | undefined =>
    withDatabase(existingStore, (store) => {
      if (store.hasSessionStarted(sessionId)) return undefined
      const mainSessionId = resolvePiMainSessionId(sessionId)
      return mainSessionId === sessionId ? undefined : mainSessionId
    })
  const contextPredecessor = (sessionId: string, existingStore?: SqliteEventStore): string | undefined =>
    withDatabase(existingStore, (store) => {
      store.db.exec(createSuccessorsTableSql)
      const row = store.db.prepare(
        'SELECT retired_session_id FROM pi_context_successors WHERE successor_session_id = ?',
      ).get(sessionId)
      return row === undefined || row === null
        ? undefined
        : retiredSessionRowSchema.parse(row).retired_session_id
    })
  const requireParent = (store: SqliteEventStore, parentSessionId: string): void => {
    if (!store.hasSessionStarted(parentSessionId)) {
      throw new TypeError(`Pi parent session ${parentSessionId} has no persisted workflow.`)
    }
  }
  const inheritedWorkflowParent = (sessionId: string, existingStore?: SqliteEventStore): string | undefined =>
    withDatabase(existingStore, (store) =>
      contextPredecessor(sessionId, store) ?? delegatedParent(sessionId, store))
  return {
    delegatedParent,
    contextPredecessor,
    resolveWorkflowSessionId(sessionId, existingStore) {
      return inheritedWorkflowParent(sessionId, existingStore) ?? sessionId
    },
    recordContextSuccessor(successorSessionId, retiredSessionId, recordedAt): void {
      withDatabase(undefined, (store) => {
        store.db.exec(createSuccessorsTableSql)
        store.db.prepare(`
          INSERT OR REPLACE INTO pi_context_successors (
            successor_session_id, retired_session_id, recorded_at
          ) VALUES (?, ?, ?)
        `).run(successorSessionId, retiredSessionId, recordedAt)
      })
    },
    hasPersistedWorkflow(sessionId): boolean {
      return withDatabase(undefined, (store) => {
        const parent = inheritedWorkflowParent(sessionId, store)
        if (parent !== undefined) {
          requireParent(store, parent)
          return true
        }
        return store.hasSessionStarted(sessionId)
      })
    },
    usesInheritedWorkflow(sessionId): boolean {
      return inheritedWorkflowParent(sessionId) !== undefined
    },
    parentSafetyFailure(event: SessionStartEvent, ctx: ExtensionContext): string | undefined {
      const parentSessionFile = ctx.sessionManager.getHeader()?.parentSession
      if (parentSessionFile === undefined) {
        return event.reason === 'fork' ? 'Forked Pi session has no verifiable parent session file.' : undefined
      }
      const parent = readPiSessionMetadata(parentSessionFile)
      return withDatabase(undefined, (store) =>
        store.hasSessionStarted(parent.id) || parent.hasWorkflowMarker
          ? `Cannot fork Pi session ${parent.id}: its workflow is active.`
          : undefined)
    },
    requireAccess(store: SqliteEventStore, sessionId: string): void {
      const parent = inheritedWorkflowParent(sessionId, store)
      if (parent !== undefined) {
        requireParent(store, parent)
      }
    },
  }
}
