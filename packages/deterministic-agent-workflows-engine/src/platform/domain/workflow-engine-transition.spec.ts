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
} from '../../index'
import {
  pass,
  WorkflowEngine,
  WorkflowStateError,
} from '../../index'

type SequencedState = {
  readonly currentStateMachineState: 'PLANNING' | 'DEVELOPING'
  readonly transcriptPath: string
}

type SequencedTransitionedEvent = BaseEvent & {
  readonly type: 'transitioned'
  readonly from: SequencedState['currentStateMachineState']
  readonly to: SequencedState['currentStateMachineState']
}

type SequencedSessionStartedEvent = BaseEvent & {
  readonly type: 'session-started'
  readonly transcriptPath: string
}

type SequencedHooks = {
  readonly onEntry?: (state: SequencedState) => SequencedState
  readonly afterEntry?: () => void
}

function isTransitionedEvent(event: BaseEvent): event is SequencedTransitionedEvent { return event.type === 'transitioned' }

function isSessionStartedEvent(event: BaseEvent): event is SequencedSessionStartedEvent { return event.type === 'session-started' }

class SequencedWorkflow {
  constructor(
    private state: SequencedState,
    private pendingEvents: Array<BaseEvent> = [],
  ) {}

  getState(): SequencedState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    if (!isTransitionedEvent(event)) {
      throw new WorkflowStateError(`Unexpected event in appendEvent: ${event.type}`)
    }
    this.pendingEvents = [...this.pendingEvents, event]
    this.state = {
      ...this.state,
      currentStateMachineState: event.to,
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
      states: ['PLANNING', 'DEVELOPING'],
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

function createSequencedWorkflowDefinition(hooks: SequencedHooks = {}): WorkflowDefinition<SequencedWorkflow, SequencedState, Record<string, never>, 'PLANNING' | 'DEVELOPING', 'write'> {
  return {
    fold(state, event) {
      if (isTransitionedEvent(event)) {
        return {
          ...state,
          currentStateMachineState: event.to,
        }
      }
      if (isSessionStartedEvent(event)) {
        return {
          ...state,
          transcriptPath: event.transcriptPath,
        }
      }
      throw new WorkflowStateError(`Unexpected event in fold: ${event.type}`)
    },
    buildWorkflow(state) {
      return new SequencedWorkflow(state)
    },
    stateSchema: z.enum(['PLANNING', 'DEVELOPING']),
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
          canTransitionTo: ['DEVELOPING'],
          allowedWorkflowOperations: [],
        },
        DEVELOPING: {
          emoji: '🛠️',
          agentInstructions: 'states/developing.md',
          canTransitionTo: [],
          allowedWorkflowOperations: [],
          onEntry: hooks.onEntry,
          afterEntry: hooks.afterEntry,
        },
      } satisfies WorkflowRegistry<SequencedState, 'PLANNING' | 'DEVELOPING', 'write'>
    },
    buildTransitionContext(state, from, to) {
      return {
        state,
        from,
        to,
      }
    },
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

class RecordingWorkflowEventStore extends InMemoryWorkflowEventStore {
  constructor(private readonly persistedEventTypes: string[]) {
    super()
  }

  appendEvents(sessionId: string, events: readonly StoredEvent[]): void {
    super.appendEvents(sessionId, events)
    this.persistedEventTypes.push(...events.map((event) => event.envelope.type))
  }
}

type TestEngine = {
  readonly engine: WorkflowEngine<SequencedWorkflow, SequencedState, Record<string, never>, 'PLANNING' | 'DEVELOPING', 'write'>
  readonly store: InMemoryWorkflowEventStore
}

function createEngine(
  definition: WorkflowDefinition<SequencedWorkflow, SequencedState, Record<string, never>, 'PLANNING' | 'DEVELOPING', 'write'>,
  store: InMemoryWorkflowEventStore = new InMemoryWorkflowEventStore(),
): TestEngine {
  const engineDeps: WorkflowEngineDeps = {
    store,
    sessionContext: { getMainSessionId: () => 'session-1' },
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:00:00Z',
    transcriptReader: { readMessages: () => [] },
  }
  return {
    store,
    engine: new WorkflowEngine(definition, engineDeps, {}),
  }
}

describe('WorkflowEngine transition persistence ordering', () => {
  it('starts afterEntry work only after the transitioned event is persisted', () => {
    const persistedEventTypes: string[] = []
    const definition = createSequencedWorkflowDefinition({
      afterEntry: () => {
        persistedEventTypes.push('afterEntry-invoked')
      },
    })
    const { engine } = createEngine(definition, new RecordingWorkflowEventStore(persistedEventTypes))
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    const result = engine.transition('session-1', 'DEVELOPING')

    expect(result.type).toBe('success')
    expect(persistedEventTypes).toStrictEqual([
      'session-started',
      'identity-verified',
      'transitioned',
      'afterEntry-invoked',
    ])
    expect(engine.getState('session-1')).toStrictEqual({
      type: 'success',
      output: JSON.stringify(
        {
          currentStateMachineState: 'DEVELOPING',
          transcriptPath: '/transcripts/session-1.jsonl',
        },
        null,
        2,
      ),
    })
  })

  it('keeps the transition committed when afterEntry fails', () => {
    const definition = createSequencedWorkflowDefinition({
      afterEntry: () => {
        throw new WorkflowStateError('review claim failed')
      },
    })
    const {
      engine,
      store,
    } = createEngine(definition)
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    const result = engine.transition('session-1', 'DEVELOPING')

    expect(result).toStrictEqual({
      type: 'error',
      output: 'Workflow operation committed, but its response could not be completed: review claim failed',
      persistence: 'committed',
    })
    expect(store.readEvents('session-1').map((event) => event.envelope.type)).toStrictEqual([
      'session-started',
      'identity-verified',
      'transitioned',
    ])
  })

  it('keeps onEntry failures uncommitted before the transitioned event persists', () => {
    const definition = createSequencedWorkflowDefinition({
      onEntry: () => {
        throw new WorkflowStateError('entry mapping failed')
      },
    })
    const {
      engine,
      store,
    } = createEngine(definition)
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    const result = engine.transition('session-1', 'DEVELOPING')

    expect(result).toStrictEqual({
      type: 'error',
      output: 'Workflow operation failed before persistence: entry mapping failed',
      persistence: 'not-attempted',
    })
    expect(store.readEvents('session-1').map((event) => event.envelope.type)).toStrictEqual([
      'session-started',
      'identity-verified',
    ])
  })
})
