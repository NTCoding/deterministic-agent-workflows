import {
  estimateTokens,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'

/** @riviere-role external-client-service */
export function refreshPiContextWindow(
  session: AgentSession,
  stateInstructions: string,
): void {
  if (stateInstructions.trim().length === 0) {
    throw new TypeError('Pi context state instructions must not be empty.')
  }
  if (!session.isIdle) {
    throw new TypeError('Cannot refresh Pi context until the session is idle.')
  }
  if (!session.sessionManager.isPersisted()) {
    throw new TypeError('Cannot refresh Pi context without a persisted session.')
  }
  const tokensBefore = session.messages.reduce((total, message) => total + estimateTokens(message), 0)
  const boundary = session.sessionManager.appendCustomEntry('pi-context-window-boundary')
  session.sessionManager.appendCompaction(stateInstructions, boundary, tokensBefore)
  session.agent.state.messages = session.sessionManager.buildSessionContext().messages
}
