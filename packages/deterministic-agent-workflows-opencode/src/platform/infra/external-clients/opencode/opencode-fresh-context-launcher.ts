import type { FreshContextLauncher } from '@nt-ai-lab/deterministic-agent-workflow-cli'

/** @riviere-role external-client-model */
export interface OpenCodeFreshContextLauncherDeps {
  readonly client: {
    readonly session: {
      readonly create: (input: Record<string, never>) => Promise<{
        readonly data?: { readonly id?: string }
        readonly id?: string
      }>
      readonly promptAsync: (input: {
        readonly path: { readonly id: string }
        readonly body: {
          readonly parts: readonly {
            readonly type: string;
            readonly text: string 
          }[] 
        }
      }) => Promise<unknown>
    }
  }
}

/** @riviere-role external-client-service */
export function createOpenCodeFreshContextLauncher(deps: OpenCodeFreshContextLauncherDeps): FreshContextLauncher {
  return {
    async start(launch): Promise<void> {
      const session = await deps.client.session.create({})
      const sessionId = session.data?.id ?? session.id
      if (sessionId === undefined || sessionId.trim().length === 0) {
        throw new TypeError('OpenCode session creation returned no session id.')
      }
      await deps.client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{
            type: 'text',
            text: launch.stateInstructions,
          }],
        },
      })
    },
  }
}
