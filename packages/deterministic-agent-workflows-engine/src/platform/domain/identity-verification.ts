import type { TranscriptMessage } from '../infra/external-clients/transcript/transcript-reader'

/** @riviere-role value-object */
export type IdentityCheckResult =
  | { readonly status: 'verified' }
  | { readonly status: 'never-spoken' }
  | { readonly status: 'silent-turn' }
  | { readonly status: 'lost' }

/** @riviere-role domain-service */
export function checkIdentity(
  messages: readonly TranscriptMessage[],
  pattern: RegExp,
): IdentityCheckResult {
  const textMessages = messages.filter((message) => message.textContent !== undefined)

  if (textMessages.length === 0) {
    return { status: 'never-spoken' }
  }

  const hasEverSpokenWithPrefix = textMessages.some(
    (message) => message.textContent !== undefined && pattern.test(message.textContent),
  )

  if (!hasEverSpokenWithPrefix) {
    return { status: 'lost' }
  }

  const lastMessage = messages.at(-1)
  if (lastMessage?.textContent === undefined) {
    return { status: 'silent-turn' }
  }

  if (pattern.test(lastMessage.textContent)) {
    return { status: 'verified' }
  }

  return { status: 'lost' }
}
