import type { ParsedEvent } from '../query/query-types'

export const WORKFLOW_STATES = ['SPAWN', 'PLANNING', 'RESPAWN', 'DEVELOPING', 'REVIEWING', 'COMMITTING', 'CR_REVIEW', 'PR_CREATION', 'FEEDBACK', 'BLOCKED', 'COMPLETE']

export function makeEvents(sessionId: string): ReadonlyArray<ParsedEvent> {
  return [
    {
      seq: 1,
      sessionId,
      type: 'session-started',
      at: '2026-01-01T00:00:00Z',
      payload: {
        repository: 'test/repo',
        currentState: 'SPAWN',
        states: WORKFLOW_STATES,
      },
    },
    {
      seq: 2,
      sessionId,
      type: 'transitioned',
      at: '2026-01-01T00:01:00Z',
      payload: {
        from: 'idle',
        to: 'SPAWN',
      },
    },
    {
      seq: 3,
      sessionId,
      type: 'agent-registered',
      at: '2026-01-01T00:02:00Z',
      payload: {
        agentType: 'lead',
        agentId: 'lead-1',
      },
    },
    {
      seq: 4,
      sessionId,
      type: 'transitioned',
      at: '2026-01-01T00:05:00Z',
      payload: {
        from: 'SPAWN',
        to: 'PLANNING',
      },
    },
    {
      seq: 5,
      sessionId,
      type: 'journal-entry',
      at: '2026-01-01T00:06:00Z',
      payload: {
        agentName: 'lead-1',
        content: 'Starting plan',
      },
    },
    {
      seq: 6,
      sessionId,
      type: 'write-checked',
      at: '2026-01-01T00:07:00Z',
      payload: {
        allowed: false,
        tool: 'Write',
        filePath: '/test.ts',
      },
    },
    {
      seq: 7,
      sessionId,
      type: 'transitioned',
      at: '2026-01-01T00:10:00Z',
      payload: {
        from: 'PLANNING',
        to: 'DEVELOPING',
      },
    },
    {
      seq: 8,
      sessionId,
      type: 'agent-shut-down',
      at: '2026-01-01T00:11:00Z',
      payload: { agentName: 'lead-1' },
    },
  ]
}
