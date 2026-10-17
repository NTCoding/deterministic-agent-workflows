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
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  pass,
  WorkflowEngine,
  WorkflowStateError,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { z } from 'zod'
import { EXIT_ALLOW } from '../../../shell/exit-codes'
import { createWorkflowRunner } from './workflow-runner'

type StopHookStateName = 'PLANNING'

type StopHookState = {
  readonly currentStateMachineState: StopHookStateName
  readonly transcriptPath: string
}

type SessionStartedEvent = BaseEvent & {readonly transcriptPath: string}

function isSessionStartedEvent(event: BaseEvent): event is SessionStartedEvent {
  return event.type === 'session-started'
}

class StopHookWorkflow implements RehydratableWorkflow<StopHookState> {
  constructor(private state: StopHookState) {}

  getState(): StopHookState {
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

  startSession(transcriptPath: string, _repository: string | undefined): void {
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

class StopHookStore implements WorkflowEventStore {
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
    throw new WorkflowStateError('Use recordReviewWithEvent for review recording')
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

const stopDecisionSchema = z.object({
  decision: z.string(),
  reason: z.string(),
})

const workflowDefinition: WorkflowDefinition<StopHookWorkflow, StopHookState, Record<string, never>, 'PLANNING', 'write'> = {
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
  buildWorkflow: (state) => new StopHookWorkflow(state),
  getRegistry() {
    return {
      PLANNING: {
        emoji: '🧭',
        agentInstructions: '',
        canTransitionTo: [],
        allowedWorkflowOperations: [],
        forbidden: { write: true },
      },
    } satisfies WorkflowRegistry<StopHookState, 'PLANNING', 'write'>
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

function buildEngineDeps(store: WorkflowEventStore): WorkflowEngineDeps {
  return {
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
}

function runHook(engineDeps: WorkflowEngineDeps, hookInput: Record<string, unknown>): {
  readonly output: string
  readonly exitCode: number
} {
  const runner = createWorkflowRunner({
    workflowDefinition,
    routes: {},
  })
  return runner([], engineDeps, {}, { readStdin: () => JSON.stringify(hookInput) })
}

function startSession(engineDeps: WorkflowEngineDeps, sessionId: string): void {
  const engine = new WorkflowEngine(workflowDefinition, engineDeps, {})
  engine.startSession(sessionId, '/transcripts/stop-hook.jsonl')
}

describe('workflow runner Stop hook', () => {
  it('blocks the stop with the identity reminder when the last message lacks the prefix', () => {
    const store = new StopHookStore()
    const engineDeps = buildEngineDeps(store)
    startSession(engineDeps, 'session-1')
    lastMessageTexts.push('plain text without the expected prefix')

    const result = runHook(engineDeps, {
      session_id: 'session-1',
      transcript_path: '/transcripts/stop-hook.jsonl',
      cwd: '/workspace',
      hook_event_name: 'Stop',
    })

    expect(result.exitCode).toBe(EXIT_ALLOW)
    const decision = stopDecisionSchema.parse(JSON.parse(result.output))
    expect(decision.decision).toBe('block')
    expect(decision.reason).toContain('Your last message is missing the required state prefix')
    expect(decision.reason).toContain('full instructions: /plugin-root/states/planning.md')
  })

  it('allows the stop when the last message carries the prefix', () => {
    const store = new StopHookStore()
    const engineDeps = buildEngineDeps(store)
    startSession(engineDeps, 'session-2')
    lastMessageTexts.push('🧭 PLANNING implementation finished')

    const result = runHook(engineDeps, {
      session_id: 'session-2',
      transcript_path: '/transcripts/stop-hook.jsonl',
      cwd: '/workspace',
      hook_event_name: 'Stop',
    })

    expect(result).toStrictEqual({
      output: '',
      exitCode: EXIT_ALLOW,
    })
  })

  it('allows the stop when the session has not started', () => {
    const store = new StopHookStore()
    const engineDeps = buildEngineDeps(store)

    const result = runHook(engineDeps, {
      session_id: 'unknown-session',
      transcript_path: '/transcripts/stop-hook.jsonl',
      cwd: '/workspace',
      hook_event_name: 'Stop',
    })

    expect(result).toStrictEqual({
      output: '',
      exitCode: EXIT_ALLOW,
    })
  })
})
