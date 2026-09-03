import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'
import type {
  EngineResult,
  RehydratableWorkflow,
  WorkflowDefinition,
  WorkflowEngineDeps,
  WorkflowEventStore,
  WorkflowRegistry,
  WorkflowStateDefinition,
} from '../../index'
import { pass } from '../../index'
import {
  checkBashWithPlatformEvents,
  checkStopAllowed,
  checkWriteWithPlatformEvents,
  writeJournalWithPlatformEvents,
} from './workflow-engine-platform-operations'

type PlanningState = {readonly currentStateMachineState: 'PLANNING'}

type PlanningDefinition = WorkflowStateDefinition<PlanningState, 'PLANNING', string>

const NOW = '2026-09-03T12:00:00.000Z'
const BLOCKED_BY_IDENTITY: EngineResult = {
  type: 'blocked',
  output: 'Identity verification failed.',
}

function createStore(): WorkflowEventStore {
  return {
    readEvents: () => [],
    appendEvents: () => undefined,
    sessionExists: () => false,
    hasSessionStarted: () => false,
    recordReflection: () => { throw new TypeError('not configured') },
    listReflections: () => [],
    recordReview: () => { throw new TypeError('not configured') },
    recordReviewWithEvent: () => { throw new TypeError('not configured') },
    listSessionReviews: () => [],
    listReviews: () => [],
  }
}

function createWorkflow(state: PlanningState): RehydratableWorkflow<PlanningState> {
  return {
    getState: () => state,
    appendEvent: () => undefined,
    getPendingEvents: () => [],
    startSession: () => undefined,
    getTranscriptPath: () => '',
    registerAgent: () => pass(),
    handleTeammateIdle: () => pass(),
  }
}

function createContext(
  definitionOverrides: Partial<PlanningDefinition> = {},
  gateResult?: EngineResult,
  operationBody?: string,
) {
  const state: PlanningState = { currentStateMachineState: 'PLANNING' }
  const workflow = createWorkflow(state)
  const registry: WorkflowRegistry<PlanningState, 'PLANNING', string> = {
    PLANNING: {
      emoji: 'PLAN',
      agentInstructions: 'states/planning.md',
      canTransitionTo: [],
      allowedWorkflowOperations: [],
      ...definitionOverrides,
    },
  }
  const factoryBase: WorkflowDefinition<
    RehydratableWorkflow<PlanningState>,
    PlanningState,
    Record<string, never>,
    'PLANNING',
    string
  > = {
    fold: (currentState) => currentState,
    buildWorkflow: () => workflow,
    stateSchema: z.literal('PLANNING'),
    initialState: () => state,
    getRegistry: () => registry,
    buildTransitionContext: (currentState, from, to) => ({
      state: currentState,
      from,
      to,
      gitInfo: {
        currentBranch: 'main',
        workingTreeClean: true,
        headCommit: 'abc123',
        changedFilesVsDefault: [],
        hasCommitsVsDefault: false,
      },
    }),
  }
  const factory = operationBody === undefined
    ? factoryBase
    : {
      ...factoryBase,
      getOperationBody: () => operationBody
    }
  const engineDeps: WorkflowEngineDeps = {
    store: createStore(),
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => NOW,
    transcriptReader: { readMessages: () => [] },
    sessionContext: { getMainSessionId: () => 'session-1' },
  }
  const events: unknown[] = []
  const applyIdentityGate = vi.fn<(operation: string) => EngineResult | undefined>(() => gateResult)
  return {
    context: {
      workflow,
      engineDeps,
      factory,
      applyIdentityGate,
      persistPlatformEvent: (event: unknown) => { events.push(event) },
    },
    events,
    applyIdentityGate,
    state,
  }
}

describe('platform operation identity gates', () => {
  it('blocks every operation before policy checks or event persistence', () => {
    const fixture = createContext({}, BLOCKED_BY_IDENTITY)
    const isWriteAllowed = vi.fn(() => true)

    expect([
      checkStopAllowed(fixture.context, 'stop'),
      writeJournalWithPlatformEvents(fixture.context, 'agent', 'entry'),
      checkBashWithPlatformEvents(fixture.context, 'bash', 'pnpm test', { commands: [] }),
      checkWriteWithPlatformEvents(fixture.context, 'Write', '/src/file.ts', isWriteAllowed),
    ]).toStrictEqual([
      BLOCKED_BY_IDENTITY,
      BLOCKED_BY_IDENTITY,
      BLOCKED_BY_IDENTITY,
      BLOCKED_BY_IDENTITY,
    ])
    expect(fixture.applyIdentityGate.mock.calls).toStrictEqual([
      ['stop-check'],
      ['write-journal'],
      ['bash-check'],
      ['write-check'],
    ])
    expect(fixture.events).toStrictEqual([])
    expect(isWriteAllowed).not.toHaveBeenCalled()
  })
})

describe('checkStopAllowed', () => {
  it.each([
    ['stop', undefined, 'Workflow state PLANNING does not allow stopping.'],
    ['question', 'AskUserQuestion', 'Workflow state PLANNING does not allow asking user questions.'],
  ] as const)('denies %s with its stopping reason', (action, tool, reason) => {
    const fixture = createContext()

    const result = checkStopAllowed(fixture.context, action, tool)

    expect(result).toStrictEqual({
      type: 'blocked',
      output: `Cannot ${action}-check\n----------------------------------------------------------------\n${reason}\n\nNext message MUST begin with: PLAN PLANNING`,
    })
    expect(fixture.events).toStrictEqual([{
      type: 'stopping-checked',
      at: NOW,
      action,
      ...(tool === undefined ? {} : { tool }),
      allowed: false,
      reason,
    }])
  })

  it('allows idle stopping without adding a denial reason', () => {
    const fixture = createContext({ allowIdle: true })

    expect(checkStopAllowed(fixture.context, 'stop')).toStrictEqual({
      type: 'success',
      output: ''
    })
    expect(fixture.events).toStrictEqual([{
      type: 'stopping-checked',
      at: NOW,
      action: 'stop',
      allowed: true,
    }])
  })
})

describe('writeJournalWithPlatformEvents', () => {
  it('persists an empty journal entry and uses the default operation guidance', () => {
    const fixture = createContext()

    expect(writeJournalWithPlatformEvents(fixture.context, 'reviewer', '')).toStrictEqual({
      type: 'success',
      output: 'write-journal\n----------------------------------------------------------------\nWrite journal entry\n\nNext message MUST begin with: PLAN PLANNING',
    })
    expect(fixture.events).toStrictEqual([{
      type: 'journal-entry',
      at: NOW,
      agentName: 'reviewer',
      content: '',
    }])
  })

  it('uses workflow-specific journal guidance when provided', () => {
    const fixture = createContext({}, undefined, 'Capture the decision')

    expect(writeJournalWithPlatformEvents(fixture.context, 'builder', 'Selected SQLite.')).toMatchObject({
      type: 'success',
      output: expect.stringContaining('Capture the decision'),
    })
  })
})

describe('checkBashWithPlatformEvents', () => {
  it('denies a forbidden shell flag and records the full reason', () => {
    const fixture = createContext()

    const result = checkBashWithPlatformEvents(
      fixture.context,
      'bash',
      'git push --force',
      {
        commands: [],
        flags: ['--force']
      },
    )

    const reason = "Bash command blocked in PLANNING. Forbidden flag '--force' in command."
    expect(result).toMatchObject({
      type: 'blocked',
      output: expect.stringContaining(reason)
    })
    expect(fixture.events).toStrictEqual([{
      type: 'bash-checked',
      at: NOW,
      tool: 'bash',
      command: 'git push --force',
      allowed: false,
      reason,
    }])
  })

  it('selects case-insensitive command checks only for the exact powershell tool name', () => {
    const lowercaseTool = createContext()
    const differentlyCasedTool = createContext()
    const forbidden = { commands: ['Remove-Item'] }

    expect(checkBashWithPlatformEvents(
      lowercaseTool.context,
      'powershell',
      'remove-item secret.txt',
      forbidden,
    ).type).toBe('blocked')
    expect(checkBashWithPlatformEvents(
      differentlyCasedTool.context,
      'PowerShell',
      'remove-item secret.txt',
      forbidden,
    )).toStrictEqual({
      type: 'success',
      output: ''
    })
    expect(differentlyCasedTool.events).toStrictEqual([{
      type: 'bash-checked',
      at: NOW,
      tool: 'PowerShell',
      command: 'remove-item secret.txt',
      allowed: true,
    }])
  })

  it('persists a denial for a differently cased PowerShell flag', () => {
    const fixture = createContext()

    const result = checkBashWithPlatformEvents(
      fixture.context,
      'powershell',
      'Remove-Item secret.txt -force',
      {
        commands: [],
        flags: ['-Force'],
      },
    )

    const reason = "Bash command blocked in PLANNING. Forbidden flag '-Force' in command."
    expect(result).toMatchObject({
      type: 'blocked',
      output: expect.stringContaining(reason),
    })
    expect(fixture.events).toStrictEqual([{
      type: 'bash-checked',
      at: NOW,
      tool: 'powershell',
      command: 'Remove-Item secret.txt -force',
      allowed: false,
      reason,
    }])
  })

  it('allows a state-exempt forbidden command', () => {
    const fixture = createContext({ allowForbidden: { bash: ['REMOVE-ITEM'] } })

    expect(checkBashWithPlatformEvents(
      fixture.context,
      'powershell',
      'Remove-Item secret.txt',
      { commands: ['remove-item'] },
    )).toStrictEqual({
      type: 'success',
      output: ''
    })
    expect(fixture.events).toStrictEqual([{
      type: 'bash-checked',
      at: NOW,
      tool: 'powershell',
      command: 'Remove-Item secret.txt',
      allowed: true,
    }])
  })
})

describe('checkWriteWithPlatformEvents', () => {
  it('always allows the platform event store without consulting state policy', () => {
    const fixture = createContext({ forbidden: { write: true } })
    const isWriteAllowed = vi.fn(() => false)

    expect(checkWriteWithPlatformEvents(
      fixture.context,
      'Write',
      '/plugin-root/workflow.db',
      isWriteAllowed,
    )).toStrictEqual({
      type: 'success',
      output: ''
    })
    expect(isWriteAllowed).not.toHaveBeenCalled()
    expect(fixture.events).toStrictEqual([{
      type: 'write-checked',
      at: NOW,
      tool: 'Write',
      filePath: '/plugin-root/workflow.db',
      allowed: true,
    }])
  })

  it('allows writes when the current state does not forbid them', () => {
    const fixture = createContext()
    const isWriteAllowed = vi.fn(() => false)

    expect(checkWriteWithPlatformEvents(
      fixture.context,
      'Edit',
      '/src/open.ts',
      isWriteAllowed,
    )).toStrictEqual({
      type: 'success',
      output: ''
    })
    expect(isWriteAllowed).not.toHaveBeenCalled()
    expect(fixture.events).toStrictEqual([{
      type: 'write-checked',
      at: NOW,
      tool: 'Edit',
      filePath: '/src/open.ts',
      allowed: true,
    }])
  })

  it('denies a forbidden write rejected by the state-specific exemption policy', () => {
    const fixture = createContext({ forbidden: { write: true } })
    const isWriteAllowed = vi.fn(() => false)

    const result = checkWriteWithPlatformEvents(fixture.context, 'Write', '/src/locked.ts', isWriteAllowed)

    const reason = "Write to '/src/locked.ts' is forbidden in state PLANNING"
    expect(result).toMatchObject({
      type: 'blocked',
      output: expect.stringContaining(reason)
    })
    expect(isWriteAllowed).toHaveBeenCalledWith('/src/locked.ts', fixture.state)
    expect(fixture.events).toStrictEqual([{
      type: 'write-checked',
      at: NOW,
      tool: 'Write',
      filePath: '/src/locked.ts',
      allowed: false,
      reason,
    }])
  })

  it('allows a forbidden write accepted by the state-specific exemption policy', () => {
    const fixture = createContext({ forbidden: { write: true } })

    expect(checkWriteWithPlatformEvents(
      fixture.context,
      'Write',
      '/docs/plan.md',
      () => true,
    )).toStrictEqual({
      type: 'success',
      output: ''
    })
    expect(fixture.events).toStrictEqual([{
      type: 'write-checked',
      at: NOW,
      tool: 'Write',
      filePath: '/docs/plan.md',
      allowed: true,
    }])
  })
})
