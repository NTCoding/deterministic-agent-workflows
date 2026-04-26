import {
  describe,
  expect,
  it,
} from 'vitest'
import type {
  BaseEvent,
  ListedReview,
  RecordReflectionInput,
  RecordReviewInput,
  RehydratableWorkflow,
  ReviewFilters,
  StoredEvent,
  StoredReflection,
  StoredReview,
  WorkflowDefinition,
  WorkflowEngineDeps,
  WorkflowEventStore,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  pass,
  toPayload,
  WorkflowStateError,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { z } from 'zod'
import {
  EXIT_ALLOW, EXIT_BLOCK, EXIT_ERROR 
} from '../../../shell/exit-codes'
import { handleRecordReviewRoute } from './review-routes'

type ReviewRouteStateName = 'PLANNING' | 'REVIEWING'

type ReviewRouteState = {readonly currentStateMachineState: ReviewRouteStateName}

class ReviewRouteWorkflow implements RehydratableWorkflow<ReviewRouteState> {
  constructor(private readonly state: ReviewRouteState) {}

  getState(): ReviewRouteState {
    return this.state
  }

  appendEvent(_event: BaseEvent): void {
    void _event
  }

  getPendingEvents(): readonly BaseEvent[] {
    return []
  }

  startSession(_transcriptPath: string, _repository: string | undefined): void {
    void _transcriptPath
    void _repository
  }

  getTranscriptPath(): string {
    return ''
  }

  registerAgent(_agentType: string, _agentId: string) {
    void _agentType
    void _agentId
    return pass()
  }

  handleTeammateIdle(_agentName: string) {
    void _agentName
    return pass()
  }
}

class ReviewRouteStore implements WorkflowEventStore {
  readonly storedReviews: StoredReview[] = []
  readonly storedEvents: StoredEvent[]

  constructor(initialState: ReviewRouteStateName = 'REVIEWING') {
    this.storedEvents = [buildStoredEvent('test-session', 'session-started', '2026-01-01T00:00:00.000Z', initialState, { currentState: initialState })]
  }

  readEvents(sessionId: string): readonly StoredEvent[] {
    return sessionId === 'test-session' ? this.storedEvents : []
  }

  appendEvents(sessionId: string, events: readonly StoredEvent[]): void {
    void sessionId
    this.storedEvents.push(...events)
  }

  sessionExists(sessionId: string): boolean {
    return sessionId === 'test-session'
  }

  hasSessionStarted(sessionId: string): boolean {
    return sessionId === 'test-session'
  }

  recordReflection(_sessionId: string, _createdAt: string, _input: RecordReflectionInput): StoredReflection {
    void _sessionId
    void _createdAt
    void _input
    throw new WorkflowStateError('Reflection storage is not configured')
  }

  listReflections(_sessionId: string): readonly StoredReflection[] {
    void _sessionId
    return []
  }

  recordReview(_sessionId: string, _createdAt: string, _input: RecordReviewInput): StoredReview {
    void _sessionId
    void _createdAt
    void _input
    throw new WorkflowStateError('Use recordReviewWithEvent for review recording')
  }

  recordReviewWithEvent(sessionId: string, createdAt: string, input: RecordReviewInput, eventState: string): StoredReview {
    const storedReview: StoredReview = {
      id: this.storedReviews.length + 1,
      sessionId,
      createdAt,
      ...input,
    }
    this.storedReviews.push(storedReview)
    this.storedEvents.push(buildStoredEvent(sessionId, 'review-recorded', createdAt, eventState, {
      reviewId: storedReview.id,
      reviewType: input.reviewType,
      verdict: input.verdict,
    }))
    return storedReview
  }

  listSessionReviews(sessionId: string): readonly StoredReview[] {
    return this.storedReviews.filter((review) => review.sessionId === sessionId)
  }

  listReviews(_filters: ReviewFilters): readonly ListedReview[] {
    void _filters
    return this.storedReviews
  }
}

function buildStoredEvent(sessionId: string, type: string, at: string, state: string, payload: Record<string, unknown>): StoredEvent {
  void sessionId
  const event = {
    type,
    at,
    ...payload,
  }
  return {
    envelope: {
      type,
      at,
      state,
    },
    payload: toPayload(event),
  }
}

const workflowDefinition: WorkflowDefinition<ReviewRouteWorkflow, ReviewRouteState, Record<string, never>, ReviewRouteStateName, 'record-review'> = {
  fold(state, event) {
    if (event.type === 'session-started') {
      if (event.currentState !== 'PLANNING' && event.currentState !== 'REVIEWING') return state
      return { currentStateMachineState: event.currentState }
    }
    if (event.type !== 'transitioned') return state
    if (event.to !== 'PLANNING' && event.to !== 'REVIEWING') return state
    return { currentStateMachineState: event.to }
  },
  buildWorkflow(state) {
    return new ReviewRouteWorkflow(state)
  },
  stateSchema: z.enum(['PLANNING', 'REVIEWING']),
  initialState() {
    return { currentStateMachineState: 'REVIEWING' }
  },
  getRegistry() {
    return {
      PLANNING: {
        emoji: '🧠',
        agentInstructions: 'planning.md',
        canTransitionTo: ['REVIEWING'],
        allowedWorkflowOperations: [],
      },
      REVIEWING: {
        emoji: '🔍',
        agentInstructions: 'reviewing.md',
        canTransitionTo: ['PLANNING'],
        allowedWorkflowOperations: ['record-review'],
      },
    }
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

function createEngineDeps(store: WorkflowEventStore): WorkflowEngineDeps {
  return {
    store,
    getPluginRoot: () => '',
    getEnvFilePath: () => '',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:01:00.000Z',
    transcriptReader: { readMessages: () => [] },
  }
}

function recordReview(store: ReviewRouteStore, readStdin: () => string, sessionId = 'test-session') {
  return handleRecordReviewRoute(
    { hasSessionStarted: (candidateSessionId) => store.hasSessionStarted(candidateSessionId) },
    createEngineDeps(store),
    workflowDefinition,
    ['record-review', '--type', 'custom-review'],
    readStdin,
    () => sessionId,
  )
}

describe('handleRecordReviewRoute', () => {
  it('returns error when stdin is invalid JSON', () => {
    const store = new ReviewRouteStore()
    const result = recordReview(store, () => '{')

    expect(result.exitCode).toBe(EXIT_ERROR)
    expect(result.output).toContain('Invalid review JSON')
    expect(store.storedReviews).toStrictEqual([])
  })

  it('returns error when verdict is unknown', () => {
    const store = new ReviewRouteStore()
    const result = recordReview(store, () => JSON.stringify({
      verdict: 'MAYBE',
      findings: [] 
    }))

    expect(result.exitCode).toBe(EXIT_ERROR)
    expect(result.output).toContain('Invalid review payload')
    expect(store.storedReviews).toStrictEqual([])
  })

  it('returns error when session has not started', () => {
    const store = new ReviewRouteStore()
    const result = recordReview(store, () => JSON.stringify({
      verdict: 'PASS',
      findings: [] 
    }), 'missing-session')

    expect(result).toStrictEqual({
      exitCode: EXIT_ERROR,
      output: 'Session missing-session has not been started',
    })
  })

  it('records review row and review event when payload is valid', () => {
    const store = new ReviewRouteStore()
    const result = recordReview(store, () => JSON.stringify({
      verdict: 'FAIL',
      findings: [{ title: 'Missing command tests' }],
    }))

    expect(result.exitCode).toBe(EXIT_ALLOW)
    expect(JSON.parse(result.output)).toStrictEqual({
      ok: true,
      id: 1,
      sessionId: 'test-session',
      createdAt: '2026-01-01T00:01:00.000Z',
      reviewType: 'custom-review',
      verdict: 'FAIL',
    })
    expect(store.storedReviews).toStrictEqual([{
      id: 1,
      sessionId: 'test-session',
      createdAt: '2026-01-01T00:01:00.000Z',
      reviewType: 'custom-review',
      sourceState: 'REVIEWING',
      verdict: 'FAIL',
      findings: [{ title: 'Missing command tests' }],
    }])
    expect(store.storedEvents.at(-1)).toStrictEqual(buildStoredEvent('test-session', 'review-recorded', '2026-01-01T00:01:00.000Z', 'REVIEWING', {
      reviewId: 1,
      reviewType: 'custom-review',
      verdict: 'FAIL',
    }))
  })

  it('preserves repeated review attempts', () => {
    const store = new ReviewRouteStore()
    recordReview(store, () => JSON.stringify({
      verdict: 'FAIL',
      findings: [{ title: 'First failure' }] 
    }))
    recordReview(store, () => JSON.stringify({
      verdict: 'PASS',
      findings: [] 
    }))

    expect(store.storedReviews.map((review) => ({
      id: review.id,
      verdict: review.verdict 
    }))).toStrictEqual([
      {
        id: 1,
        verdict: 'FAIL' 
      },
      {
        id: 2,
        verdict: 'PASS' 
      },
    ])
    expect(store.storedEvents.filter((event) => event.envelope.type === 'review-recorded')).toHaveLength(2)
  })

  it('returns blocked when current state disallows record-review', () => {
    const store = new ReviewRouteStore('PLANNING')
    const result = recordReview(store, () => JSON.stringify({
      verdict: 'PASS',
      findings: [] 
    }))

    expect(result).toStrictEqual({
      exitCode: EXIT_BLOCK,
      output: 'record-review is not allowed in state PLANNING.',
    })
    expect(store.storedReviews).toStrictEqual([])
  })
})
