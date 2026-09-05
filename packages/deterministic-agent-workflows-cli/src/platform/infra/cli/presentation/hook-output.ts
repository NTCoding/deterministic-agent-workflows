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

const AUTOMATIC_WORKFLOW_HOOK_WARNING = [
  '[Automatic Workflow Hook Response]',
  '',
  'Do not confuse this as a response from the user. The user has not seen this and therefore this should not be construed as approval to do anything.',
  '',
  'If you are blocked, switch to a state that allows you to stop and request assistance from the user. If you are not blocked, continue working.',
].join('\n')

/** @riviere-role cli-output-formatter */
export function formatStopPreventionMessage(reason?: string, customMessage?: string): string {
  return [AUTOMATIC_WORKFLOW_HOOK_WARNING, reason, customMessage]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join('\n\n')
}

/** @riviere-role cli-output-formatter */
export function formatStopDenyDecision(reason: string, customMessage?: string): string {
  return JSON.stringify({
    decision: 'block',
    reason: formatStopPreventionMessage(reason, customMessage),
  })
}

/** @riviere-role cli-output-formatter */
export function formatContextInjection(context: string): string {
  return JSON.stringify({ additionalContext: context })
}
