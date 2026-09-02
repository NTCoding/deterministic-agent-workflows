import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getWorkflowSessionId } from './workflow-session-id'

describe('getWorkflowSessionId', () => {
  it('keeps an executing session that owns a workflow', async () => {
    const getMainSessionId = vi.fn(async () => 'main-session')

    await expect(getWorkflowSessionId(
      { hasSessionStarted: () => true },
      'executing-session',
      { getMainSessionId },
    )).resolves.toBe('executing-session')

    expect(getMainSessionId).not.toHaveBeenCalled()
  })

  it('uses the main session when the executing session has no workflow', async () => {
    await expect(getWorkflowSessionId(
      { hasSessionStarted: () => false },
      'executing-session',
      { getMainSessionId: async () => 'main-session' },
    )).resolves.toBe('main-session')
  })
})
