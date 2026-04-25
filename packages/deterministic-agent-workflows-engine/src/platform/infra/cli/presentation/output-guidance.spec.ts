import { z } from 'zod'
import {
  WorkflowEngine,
  pass,
  type BaseEvent,
  type RecordReflectionInput,
  type PreconditionResult,
  type RehydratableWorkflow,
  type StoredEvent,
  type StoredReflection,
  type WorkflowDefinition,
  type WorkflowEngineDeps,
  type WorkflowEventStore,
  type WorkflowRegistry,
} from '../../../../index'
import { SEPARATOR } from './output-guidance'

declare const it: (name: string, fn: () => void) => void

interface Expectation { toEqual(expected: unknown): void }

declare const expect: (value: unknown) => Expectation

type PlanningState = {
  readonly currentStateMachineState: 'PLANNING'
  readonly transcriptPath: string
}

type WorkflowDeps = Record<string, never>

interface BlockedResult {
  readonly type: 'blocked'
  readonly output: string
}

type SessionStartedEvent = BaseEvent & {
  readonly type: 'session-started'
  readonly transcriptPath: string
}

function isSessionStartedEvent(event: BaseEvent): event is SessionStartedEvent {
  return event.type === 'session-started'
}

class PlanningWorkflow implements RehydratableWorkflow<PlanningState> {
  constructor(
    private state: PlanningState,
    private pendingEvents: BaseEvent[] = [],
  ) {}

  getState(): PlanningState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    this.pendingEvents = [...this.pendingEvents, event]
    if (isSessionStartedEvent(event)) {
      this.state = {
        ...this.state,
        transcriptPath: event.transcriptPath,
      }
    }
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pendingEvents
  }

  startSession(transcriptPath: string, _repository?: string): void {
    void _repository
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

  registerAgent(_agentType: string, _agentId: string): PreconditionResult {
    void _agentType
    void _agentId
    return pass()
  }

  handleTeammateIdle(_agentName: string): PreconditionResult {
    void _agentName
    return pass()
  }
}

class ReflectionStoreNotConfiguredError extends Error {
  constructor() {
    super('Reflection storage is not configured for this test')
    this.name = 'ReflectionStoreNotConfiguredError'
  }
}

class MemoryStore implements WorkflowEventStore {
  private readonly eventsBySessionId = new Map<string, StoredEvent[]>()

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
    return this.eventsBySessionId.get(sessionId)?.some((event) => {
      return event.envelope.type === 'session-started'
    }) ?? false
  }

  recordReflection(_sessionId: string, _createdAt: string, _input: RecordReflectionInput): StoredReflection {
    void _sessionId
    void _createdAt
    void _input
    throw new ReflectionStoreNotConfiguredError()
  }

  listReflections(): readonly StoredReflection[] {
    return []
  }
}

const procedureContent = 'PLANNING instructions'

const workflowDefinition: WorkflowDefinition<PlanningWorkflow, PlanningState, WorkflowDeps, 'PLANNING', 'write'> = {
  fold(state, event) {
    if (!isSessionStartedEvent(event)) {
      return state
    }

    return {
      ...state,
      transcriptPath: event.transcriptPath,
    }
  },
  buildWorkflow(state, _deps: WorkflowDeps) {
    void _deps
    return new PlanningWorkflow(state)
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
        agentInstructions: procedureContent,
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

const transcriptReader: WorkflowEngineDeps['transcriptReader'] = {
  readMessages: () => [{
    id: 'message-1',
    textContent: 'plain text without the expected prefix',
  }],
}

const engineDeps: WorkflowEngineDeps = {
  store: new MemoryStore(),
  getPluginRoot: () => '/plugin-root',
  getEnvFilePath: () => '/plugin-root/.env',
  readFile: (path) => {
    if (path === '/plugin-root/states/planning.md') {
      return procedureContent
    }
    return ''
  },
  appendToFile: (filePath, content) => {
    void filePath
    void content
  },
  now: () => '2026-01-01T00:00:00Z',
  transcriptReader,
}

it('reinserts the current procedure when identity verification fails', () => {
  const emptyWorkflowDeps: WorkflowDeps = {}
  const engine = new WorkflowEngine(workflowDefinition, engineDeps, emptyWorkflowDeps)
  engine.startSession('session-1', '/transcripts/session-1.jsonl')

  const result = engine.checkWrite('session-1', 'Write', '/workspace/note.md', () => true)

  const expectedOutput = [
    'Cannot write-check',
    SEPARATOR,
    'You forgot. Next message MUST begin with: 🧭 PLANNING',
    '',
    procedureContent,
    '',
    'Next message MUST begin with: 🧭 PLANNING',
  ].join('\n')

  const expectedResult: BlockedResult = {
    type: 'blocked',
    output: expectedOutput,
  }

  expect(result).toEqual(expectedResult)
})
