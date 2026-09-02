import type { SessionContext } from '@nt-ai-lab/deterministic-agent-workflow-engine'

type OpenCodeSessionGetter = (input: { readonly path: { readonly id: string } }) => Promise<unknown>

type OpenCodeSessionClient = { readonly session: { get: OpenCodeSessionGetter } }

function parentId(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) return undefined
  const data = 'data' in response ? response.data : response
  if (typeof data !== 'object' || data === null || !('parentID' in data)) return undefined
  return typeof data.parentID === 'string' && data.parentID.length > 0 ? data.parentID : undefined
}

/** @riviere-role external-client-service */
export function createOpenCodeSessionContext(sessionId: string, client: OpenCodeSessionClient): SessionContext {
  const cache: { value?: Promise<string> } = {}
  const resolveMainSessionId = (): Promise<string> => {
    cache.value ??= resolveRootSession(sessionId, client, new Set())
    return cache.value
  }
  return {
    async isSubagent(): Promise<boolean> {
      return (await resolveMainSessionId()) !== sessionId
    },
    getMainSessionId: resolveMainSessionId,
  }
}

async function resolveRootSession(sessionId: string, client: OpenCodeSessionClient, seen: ReadonlySet<string>): Promise<string> {
  if (seen.has(sessionId)) {
    throw new TypeError(`OpenCode session ancestry contains a cycle at '${sessionId}'.`)
  }
  const response = await client.session.get({ path: { id: sessionId } }).catch((error: unknown) => {
    throw new TypeError(`Unable to resolve OpenCode session '${sessionId}': ${String(error)}`)
  })
  const parent = parentId(response)
  if (parent === undefined) return sessionId
  return resolveRootSession(parent, client, new Set([...seen, sessionId]))
}
