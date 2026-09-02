import {
  describe,
  expect,
  it,
} from 'vitest'
import { z } from 'zod'
import type {
  BaseEvent,
  RehydratableWorkflow,
  StoredEvent,
  WorkflowDefinition,
  WorkflowEngineDeps,
  WorkflowEventStore,
} from '../../index'
import {
  pass,
  WorkflowEngine,
} from '../../index'

type State = {
  readonly currentStateMachineState: 'PLANNING'
  readonly transcriptPath: string
}

function createStore(): WorkflowEventStore {
  const events: StoredEvent[] = []
  return {
    readEvents: () => events,
    appendEvents: (_sessionId, appended) => { events.push(...appended) },
    sessionExists: () => events.length > 0,
    hasSessionStarted: () => events.some((event) => event.envelope.type === 'session-started'),
    recordReflection: () => { throw new TypeError('not configured') },
    listReflections: () => [],
    recordReview: () => { throw new TypeError('not configured') },
    recordReviewWithEvent: () => { throw new TypeError('not configured') },
    listSessionReviews: () => [],
    listReviews: () => [],
  }
}

class TestWorkflow implements RehydratableWorkflow<State> {
  private pendingEvents: BaseEvent[] = []

  constructor(private state: State) {}

  getState(): State {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    this.pendingEvents = [...this.pendingEvents, event]
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pendingEvents
  }

  startSession(transcriptPath: string, repository: string): void {
    this.state = {
      ...this.state,
      transcriptPath,
    }
    this.pendingEvents = [{
      type: 'session-started',
      at: '2026-08-31T00:00:00.000Z',
      transcriptPath,
      repository,
      currentState: this.state.currentStateMachineState,
      states: ['PLANNING'],
    }]
  }

  getTranscriptPath(): string {
    return this.state.transcriptPath
  }

  registerAgent() {
    return pass()
  }

  handleTeammateIdle() {
    return pass()
  }
}

function createDefinition(allowIdle: boolean): WorkflowDefinition<TestWorkflow, State, Record<string, never>, 'PLANNING'> {
  return {
    fold: (state, event) => event.type === 'session-started'
      ? {
        ...state,
        transcriptPath: String(event['transcriptPath'])
      }
      : state,
    buildWorkflow: (state) => new TestWorkflow(state),
    stateSchema: z.literal('PLANNING'),
    initialState: () => ({
      currentStateMachineState: 'PLANNING',
      transcriptPath: ''
    }),
    getRegistry: () => ({
      PLANNING: {
        emoji: '🧭',
        agentInstructions: '',
        allowIdle,
        canTransitionTo: [],
        allowedWorkflowOperations: [],
      },
    }),
    buildTransitionContext: (state, from, to) => ({
      state,
      from,
      to,
      gitInfo: {
        currentBranch: 'main',
        workingTreeClean: true,
        headCommit: 'abc',
        changedFilesVsDefault: [],
        hasCommitsVsDefault: false
      },
    }),
  }
}

function createEngine(allowIdle: boolean): {
  readonly engine: WorkflowEngine<TestWorkflow, State, Record<string, never>, 'PLANNING'>
  readonly store: WorkflowEventStore
} {
  const store = createStore()
  const deps: WorkflowEngineDeps = {
    store,
    sessionContext: { getMainSessionId: () => 'test-session' },
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-08-31T00:00:00.000Z',
    transcriptReader: { readMessages: () => [] },
  }
  return {
    engine: new WorkflowEngine(createDefinition(allowIdle), deps, {}),
    store,
  }
}

describe('WorkflowEngine stopping policy', () => {
  it('blocks questions when idle is not allowed and records the decision outside workflow state', () => {
    const {
      engine,
      store,
    } = createEngine(false)
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    const result = engine.checkStopping('session-1', 'question', 'question')

    expect({
      result,
      eventTypes: store.readEvents('session-1').map((event) => event.envelope.type),
      questionCheck: store.readEvents('session-1')[2].payload,
      state: engine.getState('session-1').type,
    }).toMatchObject({
      result: { type: 'blocked' },
      eventTypes: ['session-started', 'identity-verified', 'stopping-checked'],
      questionCheck: {
        action: 'question',
        tool: 'question',
        allowed: false
      },
      state: 'success',
    })
  })

  it('allows stopping and questions when idle is allowed', () => {
    const {
      engine,
      store,
    } = createEngine(true)
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    expect({
      stop: engine.checkStopping('session-1', 'stop'),
      question: engine.checkStopping('session-1', 'question', 'AskUserQuestion'),
      checks: store.readEvents('session-1').filter((event) => event.envelope.type === 'stopping-checked').map((event) => event.payload),
    }).toStrictEqual({
      stop: {
        type: 'success',
        output: ''
      },
      question: {
        type: 'success',
        output: ''
      },
      checks: [
        {
          action: 'stop',
          allowed: true
        },
        {
          action: 'question',
          tool: 'AskUserQuestion',
          allowed: true
        },
      ],
    })
  })
})
