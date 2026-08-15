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
  ReviewBundleRunner,
  ReviewFilters,
  StoredEvent,
  StoredReflection,
  StoredReview,
  WorkflowDefinition,
  WorkflowEngineDeps,
  WorkflowEventStore,
} from '../../index'
import {
  WorkflowEngine,
  WorkflowStateError,
} from '../../index'

type StateName = 'IMPLEMENTING' | 'REVIEWING' | 'SUBMITTING_PR' | 'BLOCKED'
const stateNameSchema = z.enum(['IMPLEMENTING', 'REVIEWING', 'SUBMITTING_PR', 'BLOCKED'])
type State = {
  readonly currentStateMachineState: StateName;
  readonly transcriptPath: string
}

class CycleWorkflow {
  constructor(private state: State, private pending: readonly BaseEvent[] = []) {}

  getState(): State { return this.state }

  appendEvent(event: BaseEvent): void {
    this.pending = [...this.pending, event]
    if (event.type === 'transitioned' && typeof event.to === 'string') {
      this.state = {
        ...this.state,
        currentStateMachineState: stateNameSchema.parse(event.to)
      }
    }
    if (event.type === 'session-started' && typeof event.transcriptPath === 'string') {
      this.state = {
        ...this.state,
        transcriptPath: event.transcriptPath
      }
    }
  }

  getPendingEvents(): readonly BaseEvent[] { return this.pending }

  startSession(transcriptPath: string, repository: string): void {
    this.appendEvent({
      type: 'session-started',
      at: '2026-01-01T00:00:00.000Z',
      transcriptPath,
      repository,
      currentState: this.state.currentStateMachineState,
      states: ['IMPLEMENTING', 'REVIEWING', 'SUBMITTING_PR', 'BLOCKED'],
    })
  }

  getTranscriptPath(): string { return this.state.transcriptPath }
  registerAgent(): { readonly pass: true } { return { pass: true } }
  handleTeammateIdle(): { readonly pass: true } { return { pass: true } }
}

class Store implements WorkflowEventStore {
  private readonly events = new Map<string, StoredEvent[]>()
  private readonly reviews = new Map<string, StoredReview[]>()

  readEvents(sessionId: string): readonly StoredEvent[] { return this.events.get(sessionId) ?? [] }
  appendEvents(sessionId: string, events: readonly StoredEvent[]): void { this.events.set(sessionId, [...this.readEvents(sessionId), ...events]) }
  sessionExists(sessionId: string): boolean { return this.events.has(sessionId) }
  hasSessionStarted(sessionId: string): boolean { return this.readEvents(sessionId).some((event) => event.envelope.type === 'session-started') }
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
  recordReview(sessionId: string, createdAt: string, input: RecordReviewInput): StoredReview { return this.record(sessionId, createdAt, input, undefined) }
  recordReviewWithEvent(sessionId: string, createdAt: string, input: RecordReviewInput, eventState: string): StoredReview { return this.record(sessionId, createdAt, input, eventState) }
  listSessionReviews(sessionId: string): readonly StoredReview[] { return this.reviews.get(sessionId) ?? [] }
  listReviews(filters: ReviewFilters): readonly ListedReview[] {
    void filters
    return []
  }

  private record(sessionId: string, createdAt: string, input: RecordReviewInput, eventState: string | undefined): StoredReview {
    const review: StoredReview = {
      ...input,
      id: this.listSessionReviews(sessionId).length + 1,
      sessionId,
      createdAt
    }
    this.reviews.set(sessionId, [...this.listSessionReviews(sessionId), review])
    if (eventState !== undefined) {
      this.appendEvents(sessionId, [{
        envelope: {
          type: 'review-recorded',
          at: createdAt,
          state: eventState
        },
        payload: {
          reviewId: review.id,
          reviewType: review.reviewType,
          verdict: review.verdict
        },
      }])
    }
    return review
  }
}

function definition(headCommit: string): WorkflowDefinition<CycleWorkflow, State, Record<string, never>, StateName> {
  return {
    fold(state, event) {
      if (event.type === 'transitioned' && typeof event.to === 'string') return {
        ...state,
        currentStateMachineState: stateNameSchema.parse(event.to)
      }
      if (event.type === 'session-started' && typeof event.transcriptPath === 'string') return {
        ...state,
        transcriptPath: event.transcriptPath
      }
      return state
    },
    buildWorkflow(state) { return new CycleWorkflow(state) },
    stateSchema: z.enum(['IMPLEMENTING', 'REVIEWING', 'SUBMITTING_PR', 'BLOCKED']),
    initialState() { return {
      currentStateMachineState: 'IMPLEMENTING',
      transcriptPath: ''
    } },
    getRegistry() {
      return {
        IMPLEMENTING: {
          emoji: '🛠',
          agentInstructions: 'implementing.md',
          canTransitionTo: ['REVIEWING'],
          allowedWorkflowOperations: []
        },
        REVIEWING: {
          emoji: '🔎',
          agentInstructions: 'reviewing.md',
          canTransitionTo: ['IMPLEMENTING', 'SUBMITTING_PR', 'BLOCKED'],
          allowedWorkflowOperations: []
        },
        SUBMITTING_PR: {
          emoji: '📤',
          agentInstructions: 'submitting.md',
          canTransitionTo: [],
          allowedWorkflowOperations: []
        },
        BLOCKED: {
          emoji: '⛔',
          agentInstructions: 'blocked.md',
          canTransitionTo: [],
          allowedWorkflowOperations: []
        },
      }
    },
    buildTransitionContext(state, from, to) {
      return {
        state,
        from,
        to,
        gitInfo: {
          currentBranch: 'feature/reviews',
          workingTreeClean: true,
          headCommit,
          changedFilesVsDefault: ['src/example.ts'],
          hasCommitsVsDefault: true
        }
      }
    },
    reviewCycle: {
      reviewingState: 'REVIEWING',
      passedState: 'SUBMITTING_PR',
      reworkState: 'IMPLEMENTING',
      blockedState: 'BLOCKED',
      buildRequest: () => ({
        reviewedCommit: headCommit,
        requiredReviewTypes: ['architecture', 'code']
      }),
    },
  }
}

function createEngine(headCommit: string, reviewBundleRunner?: ReviewBundleRunner) {
  const store = new Store()
  const deps: WorkflowEngineDeps = {
    store,
    getPluginRoot: () => '/plugin',
    getEnvFilePath: () => '/plugin/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:00:00.000Z',
    transcriptReader: { readMessages: () => [] },
    reviewBundleRunner,
  }
  return {
    store,
    engine: new WorkflowEngine(definition(headCommit), deps, {})
  }
}

describe('workflow-owned review cycles', () => {
  it('runs the required bundle once and automatically advances after every reviewer passes', () => {
    const calls = { count: 0 }
    const {
      engine, store
    } = createEngine('commit-1', {
      run: (input) => {
        calls.count += 1
        expect(input).toMatchObject({
          sessionId: 'session-1',
          repository: 'test/repo',
          reviewedCommit: 'commit-1',
          requiredReviewTypes: ['architecture', 'code']
        })
        return {
          reviews: [
            {
              reviewType: 'architecture',
              payload: {
                verdict: 'PASS',
                findings: []
              }
            },
            {
              reviewType: 'code',
              payload: {
                verdict: 'PASS',
                findings: []
              }
            },
          ]
        }
      },
    })
    engine.startSession('session-1', '/transcript.jsonl', 'test/repo')

    expect({
      hasCycle: engine.hasWorkflowOwnedReviewCycle(),
      requiredAgent: engine.isRequiredReviewAgent('session-1', 'architecture'),
      unrelatedAgent: engine.isRequiredReviewAgent('session-1', 'unrelated-agent'),
      transition: engine.transition('session-1', 'REVIEWING').type,
      calls: calls.count,
      state: engine.getState('session-1').output,
      reviews: store.listSessionReviews('session-1').map((review) => review.reviewType),
      completed: store.readEvents('session-1').map((event) => event.envelope.type).includes('review-cycle-completed'),
    }).toMatchObject({
      hasCycle: true,
      requiredAgent: true,
      unrelatedAgent: false,
      transition: 'success',
      calls: 1,
      state: expect.stringContaining('SUBMITTING_PR'),
      reviews: ['architecture', 'code'],
      completed: true,
    })
  })

  it('returns to implementation on a failed required reviewer and rejects another cycle for the same commit', () => {
    const calls = { count: 0 }
    const { engine } = createEngine('commit-1', {
      run: () => {
        calls.count += 1
        return {
          reviews: [
            {
              reviewType: 'architecture',
              payload: {
                verdict: 'PASS',
                findings: []
              }
            },
            {
              reviewType: 'code',
              payload: {
                verdict: 'FAIL',
                findings: [{ title: 'Defect' }]
              }
            },
          ]
        }
      },
    })
    engine.startSession('session-1', '/transcript.jsonl', 'test/repo')

    expect(engine.transition('session-1', 'REVIEWING').type).toBe('success')
    expect(engine.getState('session-1').output).toContain('IMPLEMENTING')
    expect(engine.transition('session-1', 'REVIEWING')).toMatchObject({ type: 'blocked' })
    expect(calls.count).toBe(1)
  })

  it('moves to BLOCKED when the workflow has no runner to execute its required review bundle', () => {
    const { engine } = createEngine('commit-1')
    engine.startSession('session-1', '/transcript.jsonl', 'test/repo')

    expect(engine.transition('session-1', 'REVIEWING')).toMatchObject({ type: 'error' })
    expect(engine.getState('session-1').output).toContain('BLOCKED')
  })
})
