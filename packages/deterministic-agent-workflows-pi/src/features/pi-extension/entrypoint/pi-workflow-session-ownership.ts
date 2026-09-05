import type {
  ExtensionContext,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import {
  createStore,
  type SqliteEventStore,
} from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { resolvePiMainSessionId } from '../../../platform/domain/pi-main-session'
import { readPiSessionMetadata } from '../../../platform/infra/external-clients/pi/pi-session-file'

interface PiWorkflowSessionOwnership {
  delegatedParent(sessionId: string, store?: SqliteEventStore): string | undefined
  hasPersistedWorkflow(sessionId: string): boolean
  usesInheritedWorkflow(sessionId: string): boolean
  parentSafetyFailure(event: SessionStartEvent, ctx: ExtensionContext): string | undefined
  requireAccess(store: SqliteEventStore, sessionId: string): void
}

/** @riviere-role cli-entrypoint */
export function createPiWorkflowSessionOwnership(
  databasePath: string,
): PiWorkflowSessionOwnership {
  const delegatedParent = (sessionId: string, existingStore?: SqliteEventStore): string | undefined => {
    const store = existingStore ?? createStore(databasePath)
    try {
      if (store.hasSessionStarted(sessionId)) return undefined
      const mainSessionId = resolvePiMainSessionId(sessionId)
      return mainSessionId === sessionId ? undefined : mainSessionId
    } finally {
      if (existingStore === undefined) store.db.close()
    }
  }
  const requireParent = (store: SqliteEventStore, parentSessionId: string): void => {
    if (!store.hasSessionStarted(parentSessionId)) {
      throw new TypeError(`Pi parent session ${parentSessionId} has no persisted workflow.`)
    }
  }
  return {
    delegatedParent,
    hasPersistedWorkflow(sessionId: string): boolean {
      const store = createStore(databasePath)
      try {
        const parentSessionId = delegatedParent(sessionId, store)
        if (parentSessionId !== undefined) {
          requireParent(store, parentSessionId)
          return true
        }
        return store.hasSessionStarted(sessionId)
      } finally {
        store.db.close()
      }
    },
    usesInheritedWorkflow(sessionId: string): boolean {
      const store = createStore(databasePath)
      try {
        return delegatedParent(sessionId, store) !== undefined
      } finally {
        store.db.close()
      }
    },
    parentSafetyFailure(event: SessionStartEvent, ctx: ExtensionContext): string | undefined {
      const parentSessionFile = ctx.sessionManager.getHeader()?.parentSession
      if (parentSessionFile === undefined) {
        return event.reason === 'fork' ? 'Forked Pi session has no verifiable parent session file.' : undefined
      }
      const parent = readPiSessionMetadata(parentSessionFile)
      const store = createStore(databasePath)
      try {
        return store.hasSessionStarted(parent.id) || parent.hasWorkflowMarker
          ? `Cannot fork Pi session ${parent.id}: its workflow is active.`
          : undefined
      } finally {
        store.db.close()
      }
    },
    requireAccess(store: SqliteEventStore, sessionId: string): void {
      const parentSessionId = delegatedParent(sessionId, store)
      if (parentSessionId !== undefined) {
        requireParent(store, parentSessionId)
      }
    },
  }
}
