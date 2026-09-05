import { existsSync } from 'node:fs'
import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const BOUNDARY_TYPE = 'pi-context-window-state'

function readBoundary(ctx: ExtensionContext) {
  const branch = ctx.sessionManager.getBranch()
  const boundary = branch.findLast((entry) => entry.type === 'custom' && entry.customType === BOUNDARY_TYPE)
  if (boundary === undefined) return undefined
  if (boundary.type !== 'custom' || typeof boundary.data !== 'string' || boundary.data.trim().length === 0) {
    throw new TypeError('Pi context boundary has invalid state instructions.')
  }
  return {
    boundary,
    instructions: boundary.data,
    entries: branch.slice(branch.indexOf(boundary))
  }
}

/** @riviere-role external-client-service */
export function createPiExtensionContextWindow(pi: ExtensionAPI) {
  pi.on('context', (_event, ctx) => {
    try {
      const window = readBoundary(ctx)
      if (window === undefined) return
      return {
        messages: [{
          role: 'user' as const,
          content: window.instructions,
          timestamp: Date.parse(window.boundary.timestamp),
        }, ...buildSessionContext(window.entries).messages],
      }
    } catch (error) {
      ctx.abort()
      ctx.ui.notify(`Pi context safety is unavailable: ${String(error)}`, 'error')
      ctx.shutdown()
      return { messages: [] }
    }
  })
  pi.on('session_before_compact', (event, ctx) => {
    try {
      const window = readBoundary(ctx)
      if (window === undefined) return
      return {
        compaction: {
          summary: window.instructions,
          firstKeptEntryId: window.boundary.id,
          tokensBefore: event.preparation.tokensBefore,
        },
      }
    } catch (error) {
      ctx.abort()
      ctx.ui.notify(`Pi context safety is unavailable: ${String(error)}`, 'error')
      ctx.shutdown()
      return { cancel: true }
    }
  })

  return (ctx: ExtensionContext, instructions: string): void => {
    if (instructions.trim().length === 0) {
      throw new TypeError('Pi context state instructions must not be empty.')
    }
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      throw new TypeError('Cannot refresh Pi context until the session is idle without pending messages.')
    }
    const sessionFile = ctx.sessionManager.getSessionFile()
    if (sessionFile === undefined || !existsSync(sessionFile)) {
      throw new TypeError('Cannot refresh Pi context without a persisted session.')
    }
    pi.appendEntry(BOUNDARY_TYPE, instructions)
    const window = readBoundary(ctx)
    if (window?.instructions !== instructions || window.boundary.id !== ctx.sessionManager.getLeafId()) {
      throw new TypeError('Pi did not persist the requested context boundary.')
    }
  }
}
