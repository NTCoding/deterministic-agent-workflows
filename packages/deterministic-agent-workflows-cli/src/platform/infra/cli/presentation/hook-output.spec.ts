import {
  describe,
  expect,
  it,
} from 'vitest'
import {
  formatStopDenyDecision,
  formatStopPreventionMessage,
} from './hook-output'

const mandatoryMessage = [
  '[Automatic Workflow Hook Response]',
  '',
  'Do not confuse this as a response from the user. The user has not seen this and therefore this should not be construed as approval to do anything.',
  '',
  'If you are blocked, switch to a state that allows you to stop and request assistance from the user. If you are not blocked, continue working.',
].join('\n')

describe('stop prevention hook output', () => {
  it('formats the mandatory automatic response warning', () => {
    expect(formatStopPreventionMessage()).toBe(mandatoryMessage)
  })

  it('appends the reason and consumer customisation without replacing the warning', () => {
    expect(formatStopPreventionMessage('Stopping is not allowed.', 'Run the blocked operation.')).toBe(
      `${mandatoryMessage}\n\nStopping is not allowed.\n\nRun the blocked operation.`,
    )
  })

  it('places the formatted message in a blocked stop decision', () => {
    expect(JSON.parse(formatStopDenyDecision('Stopping is not allowed.', 'Ask the maintainer.'))).toStrictEqual({
      decision: 'block',
      reason: `${mandatoryMessage}\n\nStopping is not allowed.\n\nAsk the maintainer.`,
    })
  })
})
