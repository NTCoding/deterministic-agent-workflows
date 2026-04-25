export const SEPARATOR = '----------------------------------------------------------------'

export const PLATFORM_NOTIFICATION_FENCE = '****************************************************************'

export const JOURNAL_GUIDANCE = [
  PLATFORM_NOTIFICATION_FENCE,
  'PLATFORM NOTIFICATION',
  '',
  'Record your progress and reasoning as you work by calling:',
  '  <workflow-command> write-journal <agent-name> "<detailed journal entry>"',
  '',
  'Use it for key decisions, progress milestones, and blockers.',
  'Every session should have a journal trail of the work performed.',
  PLATFORM_NOTIFICATION_FENCE,
].join('\n')

/** @riviere-role cli-output-formatter */
export function formatBlock(title: string, body: string): string {
  return `${title}\n${SEPARATOR}\n${body}`
}

function appendJournalGuidance(body: string): string {
  return `${body}\n\n${JOURNAL_GUIDANCE}`
}

/** @riviere-role cli-output-formatter */
export function formatTransitionSuccess(
  title: string,
  procedureContent: string,
  expectedPrefix: string,
): string {
  return formatBlock(title, appendJournalGuidance(`${procedureContent}\n\nNext message MUST begin with: ${expectedPrefix}`))
}

/** @riviere-role cli-output-formatter */
export function formatTransitionError(
  to: string,
  reason: string,
  currentProcedure: string,
  expectedPrefix: string,
): string {
  return formatBlock(
    `Cannot transition to ${to}`,
    `${reason}\n\nYou are still in the current state. Complete the checklist before transitioning.\n\n${currentProcedure}\n\nNext message MUST begin with: ${expectedPrefix}`,
  )
}

/** @riviere-role cli-output-formatter */
export function formatIllegalTransitionError(
  reason: string,
  currentProcedure: string,
  expectedPrefix: string,
): string {
  return formatBlock(
    'Illegal transition',
    `${reason}\n\nYou are still in the current state. Complete the checklist before transitioning.\n\n${currentProcedure}\n\nNext message MUST begin with: ${expectedPrefix}`,
  )
}

/** @riviere-role cli-output-formatter */
export function formatOperationGateError(op: string, reason: string, expectedPrefix: string): string {
  return formatBlock(`Cannot ${op}`, `${reason}\n\nNext message MUST begin with: ${expectedPrefix}`)
}

/** @riviere-role cli-output-formatter */
export function formatOperationSuccess(op: string, body: string, expectedPrefix: string): string {
  return formatBlock(op, `${body}\n\nNext message MUST begin with: ${expectedPrefix}`)
}

/** @riviere-role cli-output-formatter */
export function formatInitSuccess(procedureContent: string, expectedPrefix: string): string {
  return formatBlock('Feature team initialized', appendJournalGuidance(`${procedureContent}\n\nNext message MUST begin with: ${expectedPrefix}`))
}
