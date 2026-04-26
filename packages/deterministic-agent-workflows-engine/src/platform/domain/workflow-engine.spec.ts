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
  reduceWorkflowStateFromStoredEvents,
  reviewRecordedEventSchema,
  WorkflowEngine,
  WorkflowStateError,
} from '../../index'

type PlanningState = {
  readonly currentStateMachineState: 'PLANNING'
  readonly transcriptPath: string
}

type WorkflowDeps = Record<string, never>

type ReviewTrackingState = {
  readonly currentStateMachineState: 'REVIEWING'
  readonly codeReviewPassed: boolean
}

type SessionStartedEvent = BaseEvent & {
  readonly type: 'session-started'
  readonly transcriptPath: string
}

function isSessionStartedEvent(event: BaseEvent): event is SessionStartedEvent {
  return event.type === 'session-started'
}

function allowAgentRegistration(agentType: string, agentId: string) {
  void agentType
  void agentId
  return pass()
}

function allowIdleCheck(agentName: string) {
  void agentName
  return pass()
}

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
    return allowAgentRegistration(agentType, agentId)
  }

  handleTeammateIdle(agentName: string) {
    return allowIdleCheck(agentName)
  }
}

class ReviewTrackingWorkflow {
  constructor(private readonly state: ReviewTrackingState) {}

  getState(): ReviewTrackingState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    void event
    throw new WorkflowStateError('appendEvent is not used in this test')
  }

  getPendingEvents(): readonly BaseEvent[] {
    return []
  }

  startSession(transcriptPath: string, repository: string | undefined): void {
    void transcriptPath
    void repository
    throw new WorkflowStateError('startSession is not used in this test')
  }

  getTranscriptPath(): string {
    return ''
  }

  registerAgent(agentType: string, agentId: string) {
    return allowAgentRegistration(agentType, agentId)
  }

  handleTeammateIdle(agentName: string) {
    return allowIdleCheck(agentName)
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

const workflowDefinition: WorkflowDefinition<StrictPlanningWorkflow, PlanningState, WorkflowDeps, 'PLANNING', 'write'> = {
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
        forbidden: { write: true },
      },
    } satisfies WorkflowRegistry<PlanningState, 'PLANNING', 'write'>
  },
  buildTransitionContext(state, from, to) {
    return {
      state,
      from,
      to,
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

const reviewTrackingWorkflowDefinition: WorkflowDefinition<ReviewTrackingWorkflow, ReviewTrackingState, WorkflowDeps, 'REVIEWING', 'record-review'> = {
  fold(state, event) {
    const reviewRecordedEvent = reviewRecordedEventSchema.parse(event)
    if (reviewRecordedEvent.reviewType !== 'code-review') {
      return state
    }
    return {
      ...state,
      codeReviewPassed: reviewRecordedEvent.verdict === 'PASS',
    }
  },
  buildWorkflow(state) {
    return new ReviewTrackingWorkflow(state)
  },
  stateSchema: z.literal('REVIEWING'),
  initialState() {
    return {
      currentStateMachineState: 'REVIEWING',
      codeReviewPassed: false,
    }
  },
  getRegistry() {
    return {
      REVIEWING: {
        emoji: '🔎',
        agentInstructions: 'states/reviewing.md',
        canTransitionTo: [],
        allowedWorkflowOperations: ['record-review'],
      },
    } satisfies WorkflowRegistry<ReviewTrackingState, 'REVIEWING', 'record-review'>
  },
  buildTransitionContext(state, from, to) {
    return {
      state,
      from,
      to,
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

function buildStoredEvent(type: string, at: string, state: string, payload: Record<string, unknown>): StoredEvent {
  return {
    envelope: {
      type,
      at,
      state,
    },
    payload,
  }
}

function createEngine(): {
  readonly engine: WorkflowEngine<StrictPlanningWorkflow, PlanningState, WorkflowDeps, 'PLANNING', 'write'>
  readonly store: InMemoryWorkflowEventStore
} {
  const store = new InMemoryWorkflowEventStore()
  const engineDeps: WorkflowEngineDeps = {
    store,
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:00:00Z',
    transcriptReader: { readMessages: () => [] },
  }
  return {
    store,
    engine: new WorkflowEngine(workflowDefinition, engineDeps, {}),
  }
}

describe('WorkflowEngine platform-owned events', () => {
  it('persists journal and write-check events without routing them through the consumer workflow', () => {
    const {
      engine,
      store,
    } = createEngine()
    engine.startSession('session-1', '/transcripts/session-1.jsonl')

    const journalResult = engine.writeJournal('session-1', 'gpt-5.4', 'Captured planning context.')
    const writeCheckResult = engine.checkWrite('session-1', 'Read', '', () => true)
    const stateResult = engine.getState('session-1')

    expect(journalResult.type).toBe('success')
    expect(writeCheckResult).toStrictEqual({
      type: 'success',
      output: '',
    })
    expect(stateResult).toStrictEqual({
      type: 'success',
      output: JSON.stringify(
        {
          currentStateMachineState: 'PLANNING',
          transcriptPath: '/transcripts/session-1.jsonl',
        },
        null,
        2,
      ),
    })
    expect(store.readEvents('session-1').map((event) => event.envelope.type)).toStrictEqual([
      'session-started',
      'identity-verified',
      'journal-entry',
      'identity-verified',
      'write-checked',
    ])
  })

  it('keeps review-recorded available to consumer workflow state reconstruction', () => {
    const storedEvents: ReadonlyArray<StoredEvent> = [buildStoredEvent(
      'review-recorded',
      '2026-01-01T00:01:00Z',
      'REVIEWING',
      {
        reviewId: 7,
        reviewType: 'code-review',
        verdict: 'PASS',
      },
    )]

    const state = reduceWorkflowStateFromStoredEvents(reviewTrackingWorkflowDefinition, storedEvents)
    const reviewRecordedEvent = reviewRecordedEventSchema.parse({
      type: 'review-recorded',
      at: '2026-01-01T00:01:00Z',
      reviewId: 7,
      reviewType: 'code-review',
      verdict: 'PASS',
    })

    expect(reviewRecordedEvent).toStrictEqual({
      type: 'review-recorded',
      at: '2026-01-01T00:01:00Z',
      reviewId: 7,
      reviewType: 'code-review',
      verdict: 'PASS',
    })
    expect(state).toStrictEqual({
      currentStateMachineState: 'REVIEWING',
      codeReviewPassed: true,
    })
  })
})
