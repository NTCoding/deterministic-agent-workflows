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
  WorkflowRegistry,
} from '../../index'
import {
  pass,
  WorkflowEngine,
  WorkflowStateError,
} from '../../index'
import { z } from 'zod'

type CheckMessageStateName = 'PLANNING'

type CheckMessageState = {
  readonly currentStateMachineState: CheckMessageStateName
  readonly transcriptPath: string
}

type SessionStartedEvent = BaseEvent & {readonly transcriptPath: string}

function isSessionStartedEvent(event: BaseEvent): event is SessionStartedEvent {
  return event.type === 'session-started'
}

class CheckMessageWorkflow implements RehydratableWorkflow<CheckMessageState> {
  constructor(private state: CheckMessageState) {}

  getState(): CheckMessageState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    if (isSessionStartedEvent(event)) {
      this.state = {
        ...this.state,
        transcriptPath: event.transcriptPath 
      }
    }
  }

  getPendingEvents(): readonly BaseEvent[] {
    return []
  }

  startSession(transcriptPath: string, _repository: string): void {
    void _repository
    this.state = {
      ...this.state,
      transcriptPath 
    }
  }

  getTranscriptPath(): string {
    return this.state.transcriptPath
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

class CheckMessageStore implements WorkflowEventStore {
  private readonly events = new Map<string, StoredEvent[]>()

  readEvents(sessionId: string): readonly StoredEvent[] {
    return this.events.get(sessionId) ?? []
  }

  appendEvents(sessionId: string, events: readonly StoredEvent[]): void {
    this.events.set(sessionId, [...(this.events.get(sessionId) ?? []), ...events])
  }

  sessionExists(sessionId: string): boolean {
    return this.events.has(sessionId)
  }

  hasSessionStarted(sessionId: string): boolean {
    return (this.events.get(sessionId) ?? []).some((event) => event.envelope.type === 'session-started')
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
    throw new WorkflowStateError('Review storage is not configured')
  }

  recordReviewWithEvent(_sessionId: string, _createdAt: string, _input: RecordReviewInput, _eventState: string): StoredReview {
    void _eventState
    throw new WorkflowStateError('Review storage is not configured')
  }

  listSessionReviews(_sessionId: string): readonly StoredReview[] {
    void _sessionId
    return []
  }

  listReviews(_filters: ReviewFilters): readonly ListedReview[] {
    void _filters
    return []
  }
}

const lastMessageTexts: string[] = []

const workflowDefinition: WorkflowDefinition<CheckMessageWorkflow, CheckMessageState, Record<string, never>, 'PLANNING', 'write'> = {
  initialState() {
    return {
      currentStateMachineState: 'PLANNING',
      transcriptPath: '',
    }
  },
  stateSchema: z.literal('PLANNING'),
  fold(state, event) {
    if (isSessionStartedEvent(event)) {
      return {
        ...state,
        transcriptPath: event.transcriptPath 
      }
    }
    return state
  },
  buildWorkflow: (state) => new CheckMessageWorkflow(state),
  getRegistry() {
    return {
      PLANNING: {
        emoji: '🧭',
        agentInstructions: '',
        canTransitionTo: [],
        allowedWorkflowOperations: [],
        forbidden: { write: true },
      },
    } satisfies WorkflowRegistry<CheckMessageState, 'PLANNING', 'write'>
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

function buildEngine(): {
  readonly engine: WorkflowEngine<CheckMessageWorkflow, CheckMessageState, Record<string, never>, 'PLANNING', 'write'>
  readonly store: CheckMessageStore
} {
  const store = new CheckMessageStore()
  const engineDeps: WorkflowEngineDeps = {
    store,
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:00:00Z',
    transcriptReader: {
      readMessages: () => [{
        id: `message-${lastMessageTexts.length}`,
        textContent: lastMessageTexts.at(-1),
      }],
    },
  }
  return {
    store,
    engine: new WorkflowEngine(workflowDefinition, engineDeps, {}),
  }
}

describe('WorkflowEngine checkMessage', () => {
  it('reminds the agent when its last written message lacks the state prefix', () => {
    lastMessageTexts.push('plain text without the expected prefix')
    const {
      engine,
      store,
    } = buildEngine()
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    const result = engine.checkMessage('session-1')

    expect(result).toStrictEqual({
      type: 'blocked',
      output: [
        'Your last message is missing the required state prefix',
        '----------------------------------------------------------------',
        '- send a new message starting with: 🧭 PLANNING',
        '- full instructions: /plugin-root/states/planning.md',
        '',
        'Next message MUST begin with: 🧭 PLANNING',
      ].join('\n'),
    })
    expect(store.readEvents('session-1').map((event) => event.envelope.type)).toStrictEqual([
      'session-started',
      'identity-verified',
    ])
  })

  it('returns success when the last written message carries the prefix', () => {
    lastMessageTexts.push('🧭 PLANNING implementation finished')
    const {
      engine,
      store,
    } = buildEngine()
    engine.startSession('session-1', '/transcripts/session-1.jsonl', 'test/repo')

    const result = engine.checkMessage('session-1')

    expect(result).toStrictEqual({
      type: 'success',
      output: '',
    })
    expect(store.readEvents('session-1').map((event) => event.envelope.type)).toStrictEqual([
      'session-started',
      'identity-verified',
    ])
  })
})
