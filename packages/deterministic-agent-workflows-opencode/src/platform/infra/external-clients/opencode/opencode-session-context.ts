import type { SessionContext } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { OpenCodeSessionContextError } from './opencode-session-context-error'

type OpenCodeSession = {
  readonly id: string
  readonly parentID?: string
}

type OpenCodeSessionClient = { readonly session: { get: (input: { readonly path: { readonly id: string } }) => Promise<unknown> } }

/** @riviere-role external-client-service */
export function createOpenCodeSessionContext(
  client: OpenCodeSessionClient,
  executingSessionId: string,
): SessionContext {
  return { getMainSessionId: () => readMainSessionId(client, executingSessionId, new Set()) }
}

async function readMainSessionId(
  client: OpenCodeSessionClient,
  sessionId: string,
  visitedSessionIds: ReadonlySet<string>,
): Promise<string> {
  if (visitedSessionIds.has(sessionId)) {
    throw new OpenCodeSessionContextError(`OpenCode session ancestry contains a cycle at '${sessionId}'.`)
  }
  const session = readSession(await client.session.get({ path: { id: sessionId } }))
  if (session.parentID === undefined) {
    return session.id
  }
  return readMainSessionId(client, session.parentID, new Set([...visitedSessionIds, sessionId]))
}

function readSession(value: unknown): OpenCodeSession {
  const data = typeof value === 'object' && value !== null && 'data' in value
    ? value.data
    : value
  if (typeof data !== 'object' || data === null || !('id' in data) || typeof data.id !== 'string') {
    throw new OpenCodeSessionContextError('OpenCode session lookup did not return a session.')
  }
  if (!('parentID' in data) || data.parentID === undefined) {
    return { id: data.id }
  }
  if (typeof data.parentID !== 'string' || data.parentID.length === 0) {
    throw new OpenCodeSessionContextError('OpenCode session parent ID must be a non-empty string.')
  }
  return {
    id: data.id,
    parentID: data.parentID,
  }
}
