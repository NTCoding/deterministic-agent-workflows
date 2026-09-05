import type {
  ExtensionContext,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import {
  createStore,
  type SqliteEventStore,
} from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type { PiInitializationStatus } from '../../../platform/domain/pi-workflow-extension-types'
import { resolvePiMainSessionId } from '../../../platform/domain/pi-main-session'
import { readPiSessionMetadata } from '../../../platform/infra/external-clients/pi/pi-session-file'

interface PiWorkflowSessionOwnership {
  delegatedParent(sessionId: string): string | undefined
  hasPersistedWorkflow(sessionId: string): boolean
  usesInheritedWorkflow(sessionId: string): boolean
  parentSafetyFailure(event: SessionStartEvent, ctx: ExtensionContext): string | undefined
  requireAccess(store: SqliteEventStore, sessionId: string): void
}

/** @riviere-role cli-entrypoint */
export function createPiWorkflowSessionOwnership(
  databasePath: string,
): PiWorkflowSessionOwnership {
  const delegatedParent = (sessionId: string): string | undefined => {
    const mainSessionId = resolvePiMainSessionId(sessionId)
    return mainSessionId === sessionId ? undefined : mainSessionId
  }
  return {
    delegatedParent,
    hasPersistedWorkflow(sessionId: string): boolean {
      const store = createStore(databasePath)
      try {
        const parentSessionId = delegatedParent(sessionId)
        if (parentSessionId !== undefined) {
          store.requireWorkflowSessionAccess(sessionId, parentSessionId)
          return true
        }
        if (!store.hasSessionStarted(sessionId)) return false
        store.requireWorkflowSessionAccess(sessionId)
        return true
      } finally {
        store.db.close()
      }
    },
    usesInheritedWorkflow(sessionId: string): boolean {
      const store = createStore(databasePath)
      try {
        if (delegatedParent(sessionId) !== undefined) return true
        if (!store.hasSessionStarted(sessionId)) return false
        return store.requireWorkflowSessionAccess(sessionId) !== sessionId
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
      const parentSessionId = delegatedParent(sessionId)
      if (parentSessionId !== undefined || store.hasSessionStarted(sessionId)) {
        store.requireWorkflowSessionAccess(sessionId, parentSessionId)
      }
    },
  }
}

interface RefreshTransferredOwnershipInput {
  readonly sessionId: string
  readonly initializationBySession: Map<string, PiInitializationStatus>
  readonly sessionStartsById: Map<string, SessionStartEvent>
  readonly ownership: PiWorkflowSessionOwnership
  readonly initialize: (event: SessionStartEvent) => string | undefined
  readonly fail: (detail: string) => void
}

/** @riviere-role cli-entrypoint */
export function refreshTransferredOwnership(input: RefreshTransferredOwnershipInput): void {
  if (input.initializationBySession.get(input.sessionId)?.type !== 'inactive') return
  try {
    if (!input.ownership.hasPersistedWorkflow(input.sessionId)) return
    const event = input.sessionStartsById.get(input.sessionId)
    if (event === undefined) throw new TypeError(
      'Pi workflow initialization has not completed safely. Tool execution is blocked.',
    )
    input.initializationBySession.set(input.sessionId, { type: 'initializing' })
    const failure = input.initialize(event)
    if (failure !== undefined) {
      input.fail(failure)
      return
    }
    input.initializationBySession.set(input.sessionId, { type: 'ready' })
  } catch (error: unknown) {
    input.fail(String(error))
  }
}
