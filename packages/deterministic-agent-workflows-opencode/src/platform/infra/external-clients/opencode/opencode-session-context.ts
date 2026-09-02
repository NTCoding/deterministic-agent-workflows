import type { SessionContext } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { PluginInput } from '@opencode-ai/plugin'

/** @riviere-role external-client-service */
export async function createOpenCodeSessionContext(
  client: PluginInput['client'],
  executingSessionId: string,
): Promise<SessionContext> {
  const { data: session } = await client.session.get({
    path: { id: executingSessionId },
    throwOnError: true,
  })
  return { getMainSessionId: () => session.parentID ?? session.id }
}
