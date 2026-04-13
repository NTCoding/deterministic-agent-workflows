/** @riviere-role cli-output-formatter */
export function formatDenyDecision(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })
}

/** @riviere-role cli-output-formatter */
export function formatContextInjection(context: string): string {
  return JSON.stringify({ additionalContext: context })
}
