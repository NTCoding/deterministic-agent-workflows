import {
  describe,
  expect,
  it,
} from 'vitest'
import { z } from 'zod'
import type {
  BaseEvent,
  ListedReview,
  RecordReflectionInput,
  RecordReviewInput,
  ReviewFilters,
  StoredEvent,
  StoredReflection,
  StoredReview,
  WorkflowDefinition,
  WorkflowEngineDeps,
  WorkflowEventStore,
  WorkflowRegistry,
  TransitionContext,
} from '../../index'
import {
  pass,
  WorkflowEngine,
  WorkflowStateError,
} from '../../index'

type PlanningState = {
  readonly currentStateMachineState: 'PLANNING'
  readonly transcriptPath: string
}

type WorkflowDeps = Record<string, never>
type PlanningTransitionContext = TransitionContext<PlanningState, 'PLANNING'> & { readonly repositoryId: string }

type SessionStartedEvent = BaseEvent & {
  readonly type: 'session-started'
  readonly transcriptPath: string
}

function isSessionStartedEvent(event: BaseEvent): event is SessionStartedEvent { return event.type === 'session-started' }

class StrictPlanningWorkflow {
  constructor(
    private state: PlanningState,
    private pendingEvents: Array<BaseEvent> = [],
  ) {}

  getState(): PlanningState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    if (!isSessionStartedEvent(event)) {
      throw new WorkflowStateError(`Unexpected event in appendEvent: ${event.type}`)
    }
    this.pendingEvents = [...this.pendingEvents, event]
    this.state = {
      ...this.state,
      transcriptPath: event.transcriptPath,
    }
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pendingEvents
  }

  startSession(transcriptPath: string, repository: string | undefined): void {
    void repository
    this.state = {
      ...this.state,
      transcriptPath,
    }
    this.pendingEvents = [...this.pendingEvents, {
      type: 'session-started',
      at: '2026-01-01T00:00:00Z',
      transcriptPath,
      currentState: this.state.currentStateMachineState,
      states: ['PLANNING'],
    }]
  }

  getTranscriptPath(): string {
    return this.state.transcriptPath
  }

  registerAgent(agentType: string, agentId: string) {
    void agentType
    void agentId
    return pass()
  }

  handleTeammateIdle(agentName: string) {
    void agentName
    return pass()
  }
}

class InMemoryWorkflowEventStore implements WorkflowEventStore {
  private readonly eventsBySessionId = new Map<string, Array<StoredEvent>>()

  readEvents(sessionId: string): readonly StoredEvent[] {
    return this.eventsBySessionId.get(sessionId) ?? []
  }

  appendEvents(sessionId: string, events: readonly StoredEvent[]): void {
    const existingEvents = this.eventsBySessionId.get(sessionId) ?? []
    this.eventsBySessionId.set(sessionId, [...existingEvents, ...events])
  }

  sessionExists(sessionId: string): boolean {
    return this.eventsBySessionId.has(sessionId)
  }

  hasSessionStarted(sessionId: string): boolean {
    return this.readEvents(sessionId).some((event) => event.envelope.type === 'session-started')
  }

  recordReflection(sessionId: string, createdAt: string, input: RecordReflectionInput): StoredReflection {
    void sessionId
    void createdAt
    void input
    throw new WorkflowStateError('Reflection storage is not configured for this test')
  }

  listReflections(sessionId: string): readonly StoredReflection[] {
    void sessionId
    return []
  }

  recordReview(sessionId: string, createdAt: string, input: RecordReviewInput): StoredReview {
    void sessionId
    void createdAt
    void input
    throw new WorkflowStateError('Review storage is not configured for this test')
  }

  recordReviewWithEvent(sessionId: string, createdAt: string, input: RecordReviewInput, eventState: string): StoredReview {
    void sessionId
    void createdAt
    void input
    void eventState
    throw new WorkflowStateError('Review storage is not configured for this test')
  }

  listSessionReviews(sessionId: string): readonly StoredReview[] {
    void sessionId
    return []
  }

  listReviews(filters: ReviewFilters): readonly ListedReview[] {
    void filters
    return []
  }
}

const workflowDefinition: WorkflowDefinition<StrictPlanningWorkflow, PlanningState, WorkflowDeps, 'PLANNING', 'write', PlanningTransitionContext> = {
  fold(state, event) {
    if (!isSessionStartedEvent(event)) {
      throw new WorkflowStateError(`Unexpected event in fold: ${event.type}`)
    }
    return {
      ...state,
      transcriptPath: event.transcriptPath,
    }
  },
  buildWorkflow(state) {
    return new StrictPlanningWorkflow(state)
  },
  stateSchema: z.literal('PLANNING'),
  initialState() {
    return {
      currentStateMachineState: 'PLANNING',
      transcriptPath: '',
    }
  },
  getRegistry() {
    return {
      PLANNING: {
        emoji: '🧭',
        agentInstructions: 'states/planning.md',
        canTransitionTo: [],
        allowedWorkflowOperations: ['write'],
        transitionGuard: () => pass(),
      },
    } satisfies WorkflowRegistry<PlanningState, 'PLANNING', 'write', PlanningTransitionContext>
  },
  buildTransitionContext(state, from, to) {
    return {
      state,
      from,
      to,
      repositoryId: 'test-repository',
      gitInfo: {
        currentBranch: 'main',
        workingTreeClean: true,
        headCommit: 'abc123',
        changedFilesVsDefault: [],
        hasCommitsVsDefault: false,
      },
    }
  },
}

function createEngineDeps(store: InMemoryWorkflowEventStore, mainSessionId: string): WorkflowEngineDeps {
  return {
    store,
    sessionContext: { getMainSessionId: () => mainSessionId },
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:00:00Z',
    transcriptReader: { readMessages: () => [] },
  }
}

describe('WorkflowEngine context retirement', () => {
  it('persists a durable retirement event for the calling context', () => {
    const store = new InMemoryWorkflowEventStore()
    const engine = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    engine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')

    const result = engine.retireContext('host-1', 'Reviewing owns the work now.')

    const retirement = engine.getContextRetirement('host-1')
    expect(result.type).toBe('success')
    expect(retirement).toMatchObject({
      type: 'context-retired',
      hostSessionId: 'host-1',
      reason: 'Reviewing owns the work now.',
    })
  })

  it('refuses writes, bash, transitions, and operations from the retired context', () => {
    const store = new InMemoryWorkflowEventStore()
    const engine = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    engine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')
    engine.retireContext('host-1', 'Reviewing owns the work now.')

    const write = engine.checkWrite('host-1', 'Write', 'src/file.ts', () => true)
    const bash = engine.checkBash('host-1', 'Bash', 'ls', { commands: [] })
    const operation = engine.transaction('host-1', 'write', () => pass())
    const transition = engine.transition('host-1', 'PLANNING')

    expect(write).toMatchObject({ type: 'blocked' })
    expect(write.output).toContain('retired')
    expect([bash.type, operation.type, transition.type]).toStrictEqual(['blocked', 'blocked', 'blocked'])
  })

  it('keeps a fresh replacement context working on the same workflow session', () => {
    const store = new InMemoryWorkflowEventStore()
    const engine = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    engine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')
    engine.retireContext('host-1', 'Reviewing owns the work now.')

    const freshWrite = engine.checkWrite('fresh-host', 'Write', 'src/file.ts', () => true)
    const freshOperation = engine.transaction('fresh-host', 'write', () => pass())

    expect(freshWrite.type).toBe('success')
    expect(freshOperation.type).toBe('success')
  })

  it('refuses the retired context again after a restart on the same event stream', () => {
    const store = new InMemoryWorkflowEventStore()
    const engine = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    engine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')
    engine.retireContext('host-1', 'Reviewing owns the work now.')

    const restarted = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    const write = restarted.checkWrite('host-1', 'Write', 'src/file.ts', () => true)

    expect(write).toMatchObject({ type: 'blocked' })
    expect(restarted.getContextRetirement('host-1')?.hostSessionId).toBe('host-1')
  })

  it('is idempotent when the same context retires twice', () => {
    const store = new InMemoryWorkflowEventStore()
    const engine = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    engine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')

    const first = engine.retireContext('host-1', 'Reviewing owns the work now.')
    const second = engine.retireContext('host-1', 'Reviewing owns the work now.')

    expect(first.type).toBe('success')
    expect(second.type).toBe('success')
    expect(store.readEvents('host-1').filter((event) => event.envelope.type === 'context-retired')).toHaveLength(1)
  })

  it('still lets the retired context stop and read state so it can end quietly', () => {
    const store = new InMemoryWorkflowEventStore()
    const engine = new WorkflowEngine(workflowDefinition, createEngineDeps(store, 'host-1'), {})
    engine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')
    const stopBeforeRetirement = engine.checkStopping('host-1', 'stop')
    engine.retireContext('host-1', 'Reviewing owns the work now.')

    const state = engine.getState('host-1')
    const stopAfterRetirement = engine.checkStopping('host-1', 'stop')

    expect(state.type).toBe('success')
    expect(stopAfterRetirement).toStrictEqual(stopBeforeRetirement)
  })
})
