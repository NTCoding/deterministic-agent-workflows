import {
  describe, it, expect 
} from 'vitest'
import type { ParsedEvent } from '../query/query-types'
import {projectSession,} from './session-projector'
import {
  makeEvents, WORKFLOW_STATES 
} from './session-projector-test-fixtures'

describe('projectSession', () => {
  it('computes correct current state', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.currentState).toBe('DEVELOPING')
  })

  it('counts events correctly', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.totalEvents).toBe(8)
  })

  it('tracks transitions', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.transitionCount).toBe(3)
  })

  it('tracks agents', () => {
    const events = makeEvents('s1').slice(0, 3)
    const projection = projectSession('s1', events)
    expect(projection.activeAgents).toStrictEqual(['lead-1'])
  })

  it('removes shut-down agents', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.activeAgents).toStrictEqual([])
  })

  it('counts permission denials', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.permissionDenials.write).toBe(1)
    expect(projection.permissionDenials.bash).toBe(0)
  })

  it('counts plugin-read-checked denials', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'plugin-read-checked',
        at: '2026-01-01T00:00:00Z',
        payload: {
          allowed: false,
          tool: 'Read',
          path: '/plugin' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.permissionDenials.pluginRead).toBe(1)
  })

  it('counts idle-checked denials', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'idle-checked',
        at: '2026-01-01T00:00:00Z',
        payload: {
          allowed: false,
          agentName: 'dev' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.permissionDenials.idle).toBe(1)
  })

  it('counts bash-checked denials', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'bash-checked',
        at: '2026-01-01T00:00:00Z',
        payload: {
          allowed: false,
          tool: 'Bash',
          command: 'git push' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.permissionDenials.bash).toBe(1)
  })

  it('does not count allowed permission events as denials', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'plugin-read-checked',
        at: '2026-01-01T00:00:00Z',
        payload: {
          allowed: true,
          tool: 'Read',
          path: '/file' 
        } 
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'idle-checked',
        at: '2026-01-01T00:01:00Z',
        payload: {
          allowed: true,
          agentName: 'dev' 
        } 
      },
      {
        seq: 3,
        sessionId: 's1',
        type: 'bash-checked',
        at: '2026-01-01T00:02:00Z',
        payload: {
          allowed: true,
          tool: 'Bash',
          command: 'echo hi' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.permissionDenials.pluginRead).toBe(0)
    expect(projection.permissionDenials.idle).toBe(0)
    expect(projection.permissionDenials.bash).toBe(0)
  })

  it('ignores duplicate agent registrations', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'agent-registered',
        at: '2026-01-01T00:00:00Z',
        payload: {
          agentType: 'lead',
          agentId: 'lead-1' 
        } 
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'agent-registered',
        at: '2026-01-01T00:01:00Z',
        payload: {
          agentType: 'lead',
          agentId: 'lead-1' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.activeAgents).toStrictEqual(['lead-1'])
  })

  it('handles session-started without repository', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:00:00Z',
        payload: {} 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.repository).toBeUndefined()
  })

  it('handles session-started with empty repository string', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:00:00Z',
        payload: { repository: '' } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.repository).toBeUndefined()
  })

  it('does not remove agent not in active list', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'agent-shut-down',
        at: '2026-01-01T00:00:00Z',
        payload: { agentName: 'nonexistent' } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.activeAgents).toStrictEqual([])
  })

  it('handles agent-registered with empty agentId', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'agent-registered',
        at: '2026-01-01T00:00:00Z',
        payload: {
          agentType: 'lead',
          agentId: '' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.activeAgents).toStrictEqual([])
  })

  it('handles transition without preceding state period', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'transitioned',
        at: '2026-01-01T00:01:00Z',
        payload: {
          from: 'idle',
          to: 'SPAWN' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.statePeriods).toHaveLength(1)
    expect(projection.statePeriods[0]?.state).toBe('SPAWN')
  })

  it('skips malformed transitioned event (missing required fields)', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'transitioned',
        at: '2026-01-01T00:00:00Z',
        payload: {} 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.currentState).toBe('initial state')
    expect(projection.transitionCount).toBe(0)
    expect(projection.totalEvents).toBe(1)
  })

  it('skips malformed agent-registered (missing required fields)', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'agent-registered',
        at: '2026-01-01T00:00:00Z',
        payload: {} 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.activeAgents).toStrictEqual([])
    expect(projection.totalEvents).toBe(1)
  })

  it('skips malformed agent-shut-down (missing required fields)', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'agent-shut-down',
        at: '2026-01-01T00:00:00Z',
        payload: {} 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.activeAgents).toStrictEqual([])
    expect(projection.totalEvents).toBe(1)
  })

  it('skips malformed journal-entry (missing required fields)', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'journal-entry',
        at: '2026-01-01T00:00:00Z',
        payload: {} 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.journalEntries).toHaveLength(0)
    expect(projection.journalEntryCount).toBe(0)
    expect(projection.totalEvents).toBe(1)
  })

  it('tracks unknown event types without crashing', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'custom-domain-event',
        at: '2026-01-01T00:00:00Z',
        payload: { foo: 'bar' } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.totalEvents).toBe(1)
  })

  it('collects journal entries with state context', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.journalEntries).toHaveLength(1)
    expect(projection.journalEntries[0]?.agentName).toBe('lead-1')
    expect(projection.journalEntries[0]?.state).toBe('PLANNING')
  })

  it('records state periods', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.statePeriods).toHaveLength(3)
    expect(projection.statePeriods[0]?.state).toBe('SPAWN')
  })

  it('records repository from session-started', () => {
    const projection = projectSession('s1', makeEvents('s1'))
    expect(projection.repository).toBe('test/repo')
  })

  it('records current state and workflow states from session-started', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:00:00Z',
        payload: {
          currentState: 'SPAWN',
          states: WORKFLOW_STATES 
        } 
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'write-checked',
        at: '2026-01-01T00:01:00Z',
        payload: {
          allowed: true,
          tool: 'Write',
          filePath: '/workspace/test.ts' 
        } 
      },
    ]
    const projection = projectSession('s1', events)
    expect(projection.currentState).toBe('SPAWN')
    expect(projection.workflowStates).toStrictEqual(WORKFLOW_STATES)
  })

  it('handles empty events', () => {
    const projection = projectSession('s1', [])
    expect(projection.currentState).toBe('initial state')
    expect(projection.totalEvents).toBe(0)
  })

  it('adds initial state period when no transitions are recorded', () => {
    const events: ReadonlyArray<ParsedEvent> = [
      {
        seq: 1,
        sessionId: 's1',
        type: 'session-started',
        at: '2026-01-01T00:00:00Z',
        payload: {
          repository: 'test/repo',
          currentState: 'SPAWN',
          states: WORKFLOW_STATES 
        } 
      },
      {
        seq: 2,
        sessionId: 's1',
        type: 'write-checked',
        at: '2026-01-01T00:05:00Z',
        payload: {
          allowed: true,
          tool: 'Read',
          filePath: '/tmp' 
        } 
      },
    ]

    const projection = projectSession('s1', events)
    expect(projection.transitionCount).toBe(0)
    expect(projection.statePeriods).toHaveLength(1)
    expect(projection.statePeriods[0]?.state).toBe('SPAWN')
    expect((projection.statePeriods[0]?.durationMs ?? 0) > 0).toBe(true)
  })

})
