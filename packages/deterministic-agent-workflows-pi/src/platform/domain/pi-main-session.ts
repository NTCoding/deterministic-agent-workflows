const PI_SUBAGENT_PARENT_SESSION = 'PI_SUBAGENT_PARENT_SESSION'

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
