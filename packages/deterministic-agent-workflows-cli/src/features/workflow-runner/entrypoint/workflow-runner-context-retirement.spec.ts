import {
  describe,
  expect,
  it,
} from 'vitest'
import { z } from 'zod'
import type {
  BaseEvent,
  ListedReview,
  PreconditionResult,
  ReviewFilters,
  StoredEvent,
  StoredReflection,
  StoredReview,
  TransitionContext,
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
import {
  EXIT_ALLOW,
  EXIT_BLOCK,
} from '../../../shell/exit-codes'
import { createWorkflowRunner } from './workflow-runner'

type PlanningState = {
  readonly currentStateMachineState: 'PLANNING'
  readonly transcriptPath: string
}

type PlanningTransitionContext = TransitionContext<PlanningState, 'PLANNING'>

type SessionStartedEvent = BaseEvent & {
  readonly type: 'session-started'
  readonly transcriptPath: string
}

function isSessionStartedEvent(event: BaseEvent): event is SessionStartedEvent {
  return event.type === 'session-started'
}

class Workflow {
  constructor(
    private state: PlanningState,
    private pendingEvents: BaseEvent[] = [],
  ) {}

  getState(): PlanningState {
    return this.state
  }

  getTranscriptPath(): string {
    return this.state.transcriptPath
  }

  registerAgent(): PreconditionResult {
    return pass()
  }

  handleTeammateIdle(): PreconditionResult {
    return pass()
  }

  appendEvent(event: BaseEvent): void {
    if (!isSessionStartedEvent(event)) {
      throw new WorkflowStateError(`Unexpected event in appendEvent: ${event.type}`)
    }
    this.pendingEvents = [...this.pendingEvents, event]
    this.state = {
      ...this.state,
      transcriptPath: event.transcriptPath 
    }
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pendingEvents
  }

  startSession(transcriptPath: string): void {
    this.appendEvent({
      type: 'session-started',
      at: '2026-01-01T00:00:00Z',
      transcriptPath,
      currentState: this.state.currentStateMachineState,
      states: ['PLANNING'],
    })
  }
}

class InMemoryWorkflowEventStore implements WorkflowEventStore {
  private readonly eventsBySessionId = new Map<string, StoredEvent[]>()

  readEvents(sessionId: string): readonly StoredEvent[] {
    return this.eventsBySessionId.get(sessionId) ?? []
  }

  appendEvents(sessionId: string, events: readonly StoredEvent[]): void {
    const existing = this.eventsBySessionId.get(sessionId) ?? []
    this.eventsBySessionId.set(sessionId, [...existing, ...events])
  }

  sessionExists(sessionId: string): boolean {
    return this.eventsBySessionId.has(sessionId)
  }

  hasSessionStarted(sessionId: string): boolean {
    return this.readEvents(sessionId).some((event) => event.envelope.type === 'session-started')
  }

  recordReflection(): StoredReflection {
    throw new WorkflowStateError('Reflection storage is not configured for this test')
  }

  listReflections(): readonly StoredReflection[] {
    return []
  }

  recordReview(): StoredReview {
    throw new WorkflowStateError('Review storage is not configured for this test')
  }

  recordReviewWithEvent(): StoredReview {
    throw new WorkflowStateError('Review storage is not configured for this test')
  }

  listSessionReviews(): readonly StoredReview[] {
    return []
  }

  listReviews(_filters: ReviewFilters): readonly ListedReview[] {
    return []
  }
}

const workflowDefinition: WorkflowDefinition<Workflow, PlanningState, Record<string, never>, 'PLANNING', 'write', PlanningTransitionContext> = {
  fold(state, event) {
    if (!isSessionStartedEvent(event)) {
      throw new WorkflowStateError(`Unexpected event in fold: ${event.type}`)
    }
    return {
      ...state,
      transcriptPath: event.transcriptPath 
    }
  },
  buildWorkflow: (state) => new Workflow(state),
  stateSchema: z.literal('PLANNING'),
  initialState: () => ({
    currentStateMachineState: 'PLANNING',
    transcriptPath: '',
  }),
  getRegistry() {
    return {
      PLANNING: {
        emoji: 'PLAN',
        agentInstructions: 'states/planning.md',
        canTransitionTo: [],
        allowedWorkflowOperations: [],
      },
    } satisfies WorkflowRegistry<PlanningState, 'PLANNING', 'write', PlanningTransitionContext>
  },
  buildTransitionContext(state, from, to) {
    return {
      state,
      from,
      to,
      gitInfo: {
        currentBranch: 'main',
        workingTreeClean: true,
        headCommit: 'abc',
        changedFilesVsDefault: [],
        hasCommitsVsDefault: false,
      },
    }
  },
}

function createEngineDeps(store: InMemoryWorkflowEventStore): WorkflowEngineDeps {
  return {
    store,
    sessionContext: { getMainSessionId: () => 'host-1' },
    getPluginRoot: () => '/plugin-root',
    getEnvFilePath: () => '/plugin-root/.env',
    readFile: () => '',
    appendToFile: () => undefined,
    now: () => '2026-01-01T00:00:00Z',
    transcriptReader: { readMessages: () => [] },
  }
}

function createRunnerHarness() {
  const store = new InMemoryWorkflowEventStore()
  const engineDeps = createEngineDeps(store)
  const retireEngine = new WorkflowEngine(workflowDefinition, engineDeps, {})
  retireEngine.startSession('host-1', '/sessions/host-1.jsonl', 'repository')
  const runner = createWorkflowRunner({
    workflowDefinition,
    routes: {init: { type: 'session-start' },},
    unknownCommandMessage: 'Run a supported workflow operation.',
    bashForbidden: { commands: [] },
    isWriteAllowed: () => true,
    questionToolName: 'question',
  })
  const runHook = (stdin: unknown) => runner([], engineDeps, {}, { readStdin: () => JSON.stringify(stdin) })
  return {
    store,
    retireEngine,
    runner,
    runHook,
  }
}

describe('workflow runner context retirement', () => {
  it('refuses tool use from the retired context through the hook path', () => {
    const {
      retireEngine,
      runHook,
    } = createRunnerHarness()
    retireEngine.retireContext('host-1', 'Reviewing owns the work.')

    const result = runHook({
      hook_event_name: 'PreToolUse',
      session_id: 'host-1',
      transcript_path: '/sessions/host-1.jsonl',
      cwd: '/repository',
      tool_name: 'Write',
      tool_input: { file_path: 'src/file.ts' },
      tool_use_id: 'tool-1',
    })

    expect(result.exitCode).toBe(EXIT_BLOCK)
    expect(result.output).toContain('retired')
  })

  it('still enforces normal policy for a fresh replacement context on the same workflow', () => {
    const {
      retireEngine,
      runHook,
    } = createRunnerHarness()
    retireEngine.retireContext('host-1', 'Reviewing owns the work.')

    const result = runHook({
      hook_event_name: 'PreToolUse',
      session_id: 'fresh-host',
      transcript_path: '/sessions/host-1.jsonl',
      cwd: '/repository',
      tool_name: 'Write',
      tool_input: { file_path: 'src/file.ts' },
      tool_use_id: 'tool-2',
    })

    expect(result.exitCode).toBe(EXIT_ALLOW)
  })

  it('lets the retired context stop instead of forcing it to continue', () => {
    const {
      retireEngine,
      runHook,
    } = createRunnerHarness()
    retireEngine.retireContext('host-1', 'Reviewing owns the work.')

    const result = runHook({
      hook_event_name: 'Stop',
      session_id: 'host-1',
      transcript_path: '/sessions/host-1.jsonl',
      cwd: '/repository',
    })

    expect(result.exitCode).toBe(EXIT_ALLOW)
    expect(result.output).toBe('')
  })
})
