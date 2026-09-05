import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'

const PI_SUBAGENT_PARENT_SESSION = 'PI_SUBAGENT_PARENT_SESSION'

/** @riviere-role value-object */
export interface PiFreshSessionResult {
  readonly previousSessionId: string
  readonly sessionId: string
}

/** @riviere-role value-object */
export interface PiFreshSessionRuntime {
  readonly session: Pick<AgentSessionRuntime['session'], 'isStreaming' | 'prompt' | 'sessionId'>
  newSession: AgentSessionRuntime['newSession']
}

/** @riviere-role domain-service */
export function resolvePiMainSessionId(
  currentSessionId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const current = currentSessionId.trim()
  if (current.length === 0) throw new TypeError('Pi returned an empty session UUID.')
  const rawParent = environment[PI_SUBAGENT_PARENT_SESSION]
  if (rawParent === undefined) return current
  const parent = rawParent.trim()
  if (parent.length === 0) {
    throw new TypeError(`${PI_SUBAGENT_PARENT_SESSION} must contain a non-empty session UUID.`)
  }
  return parent
}

/** @riviere-role domain-service */
export async function replaceWithFreshPiSession(
  runtime: PiFreshSessionRuntime,
  stateInstructions: string,
): Promise<PiFreshSessionResult> {
  if (stateInstructions.trim().length === 0) {
    throw new TypeError('Fresh Pi session state instructions must not be empty.')
  }
  const previousSessionId = runtime.session.sessionId
  if (runtime.session.isStreaming) {
    throw new TypeError('Cannot replace a streaming Pi session. Abort and settle it first.')
  }
  const result = await runtime.newSession()
  if (result.cancelled) throw new TypeError('Pi fresh-session replacement was cancelled.')
  const sessionId = runtime.session.sessionId
  if (sessionId === previousSessionId) {
    throw new TypeError('Pi fresh-session replacement retained the previous session UUID.')
  }
  await runtime.session.prompt(stateInstructions)
  return {
    previousSessionId,
    sessionId,
  }
}
