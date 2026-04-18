import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  StoredEvent,
  WorkflowDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { flattenStoredEvent } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  buildDenialSummary,
  buildObservedEventTypes,
  buildStateDurationSummary,
  buildToolSummary,
  buildTransitionSummary,
  computeStatePeriods,
} from './reflection-process-observations'
import type { ReflectionProcess } from './reflection-process-types'

function computeCurrentState<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>, events: readonly StoredEvent[]): string {
  return events.reduce(
    (state, event) => workflowDefinition.fold(state, flattenStoredEvent(event)),
    workflowDefinition.initialState(),
  ).currentStateMachineState
}

function buildDiscoverySources(input: {
  readonly sessionId: string
  readonly repositoryRoot?: string
  readonly transcriptPath?: string
  readonly eventStorePath?: string
}): ReflectionProcess['discovery']['sources'] {
  return [
    ...(input.repositoryRoot === undefined ? [] : [{
      kind: 'repository-root' as const,
      path: input.repositoryRoot,
    }]),
    ...(input.transcriptPath === undefined || input.transcriptPath === '' ? [] : [{
      kind: 'transcript' as const,
      path: input.transcriptPath,
    }]),
    ...(input.eventStorePath === undefined || input.eventStorePath === '' ? [] : [{
      kind: 'event-store' as const,
      path: input.eventStorePath,
      sessionId: input.sessionId,
    }]),
  ]
}

/** @riviere-role domain-service */
export function buildReflectionProcess<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string,
  TOperation extends string,
>(input: {
  readonly sessionId: string
  readonly repository?: string
  readonly repositoryRoot?: string
  readonly transcriptPath?: string
  readonly eventStorePath?: string
  readonly workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>
  readonly events: readonly StoredEvent[]
}): ReflectionProcess {
  const currentState = computeCurrentState(input.workflowDefinition, input.events)
  const periods = computeStatePeriods(input.events, currentState)

  return {
    schemaVersion: 1,
    context: {
      sessionId: input.sessionId,
      ...(input.repository === undefined ? {} : { repository: input.repository }),
      ...(input.repositoryRoot === undefined ? {} : { repositoryRoot: input.repositoryRoot }),
      ...(input.transcriptPath === undefined || input.transcriptPath === '' ? {} : { transcriptPath: input.transcriptPath }),
      ...(input.eventStorePath === undefined || input.eventStorePath === '' ? {} : { eventStorePath: input.eventStorePath }),
      currentState,
    },
    discovery: {sources: buildDiscoverySources(input),},
    workflow: {
      knownStates: Object.keys(input.workflowDefinition.getRegistry()).sort((a, b) => a.localeCompare(b)),
      observedEventTypes: buildObservedEventTypes(input.events),
    },
    observations: {
      stateDurations: buildStateDurationSummary(periods),
      transitions: buildTransitionSummary(input.events),
      denials: buildDenialSummary(input.events),
      tools: buildToolSummary(input.transcriptPath, input.sessionId, periods),
    },
    instructions: {
      objective: 'Produce optimisation opportunities only for this session. Do not restate information already visible in the UI.',
      questionsToAnswer: [
        'Where was the most time spent, and why?',
        'Did any state loops indicate rework or late discovery?',
        'Did a review phase or quality gate discover issues later than it should have?',
        'Were instructions unclear, tools blocked, or better tools unused?',
        'What concrete workflow, tooling, or process change would improve the next run?',
      ],
      constraints: [
        'Do not include what went well.',
        'Do not summarize the session without an improvement conclusion.',
        'Do not assume the largest numbers are the most important issues.',
        'Use raw evidence only to confirm cause and recommendation.',
        'Every finding must be evidence-backed and actionable.',
      ],
      recommendedSteps: [
        'Scan the repository to find the project workflow definition and related state files.',
        'Review the observed event types to understand workflow-specific signals.',
        'Inspect the event log and transcript for the observations that appear most relevant.',
        'Record only structured optimisation findings that match the required output schema.',
      ],
    },
    output: {
      kind: 'reflection',
      schemaVersion: 1,
      allowedCategories: [
        'state-efficiency',
        'review-rework',
        'quality-gates',
        'tooling',
        'workflow-design',
      ],
      maxFindings: 10,
    },
  }
}

/** @riviere-role domain-service */
export function resolveRepository(events: readonly StoredEvent[]): string | undefined {
  for (const event of events) {
    if (event.envelope.type !== 'session-started') continue
    const repository = event.payload['repository']
    if (typeof repository === 'string' && repository.length > 0) return repository
  }
  return undefined
}
