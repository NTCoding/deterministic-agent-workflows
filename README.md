# deterministic-agent-workflows

Coding agents are bad at following process from markdown alone.

This library puts the process in code.

It lets users define workflow states, legal transitions, and tool rules. The runtime then enforces them.

Example:
- block `Write` outside `DEVELOPING`
- block `gh pr create` before `REVIEWING`
- block transition to `REVIEWING` until there is at least one commit and the working tree is clean

It also records workflow events so the Control Center can show:
- current state
- transitions
- blocked actions
- session history

## Install

```bash
pnpm add @nt-ai-lab/deterministic-agent-workflow-engine
pnpm add @nt-ai-lab/deterministic-agent-workflow-dsl
pnpm add @nt-ai-lab/deterministic-agent-workflow-cli

# choose an adapter
pnpm add @nt-ai-lab/deterministic-agent-workflow-opencode
# or
pnpm add @nt-ai-lab/deterministic-agent-workflow-claude-code
```

## OpenCode example

Define the workflow in the user repo, then plug it into OpenCode.

```ts
import { createOpenCodeWorkflowPlugin } from '@nt-ai-lab/deterministic-agent-workflow-opencode'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import type {
  Workflow,
  WorkflowDeps,
} from './features/workflow/domain/workflow'
import type {
  WorkflowOperation,
  WorkflowState,
  StateName,
} from './features/workflow/domain/workflow-types'
import { WORKFLOW_DEFINITION } from './features/workflow/infra/persistence/workflow-definition'
import { ROUTES, PRE_TOOL_USE_POLICY } from './features/workflow/entrypoint/workflow-cli'
import { getGitInfo } from './features/workflow/infra/external-clients/git/git'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export default createOpenCodeWorkflowPlugin<
  Workflow,
  WorkflowState,
  WorkflowDeps,
  StateName,
  WorkflowOperation
>({
  workflowDefinition: WORKFLOW_DEFINITION,
  routes: ROUTES,
  bashForbidden: PRE_TOOL_USE_POLICY.bashForbidden,
  isWriteAllowed: PRE_TOOL_USE_POLICY.isWriteAllowed,
  pluginRoot,
  commandDirectories: [join(pluginRoot, 'commands')],
  commandPrefix: 'dev-workflow:',
  buildWorkflowDeps: (platform) => ({
    getGitInfo,
    now: platform.now,
  }),
})
```

## Workflow definition + policy example

```ts
import { z } from 'zod'

export const STATE_NAME_SCHEMA = z.enum(['PLANNING', 'DEVELOPING', 'REVIEWING'])

export type StateName = z.infer<typeof STATE_NAME_SCHEMA>
export type WorkflowOperation =
  | 'record-plan'
  | 'record-branch'
  | 'record-implementation-progress'
  | 'record-review-passed'
  | 'record-review-failed'
  | 'record-pr'

export type WorkflowState = {
  currentStateMachineState: StateName
  transcriptPath?: string
}

export const INITIAL_STATE: WorkflowState = {
  currentStateMachineState: 'PLANNING',
}

export const WORKFLOW_REGISTRY = {
  PLANNING: {
    canTransitionTo: ['DEVELOPING'],
    allowedWorkflowOperations: ['record-plan'],
    forbidden: { write: true },
  },
  DEVELOPING: {
    canTransitionTo: ['REVIEWING'],
    allowedWorkflowOperations: ['record-branch', 'record-implementation-progress'],
  },
  REVIEWING: {
    canTransitionTo: ['DEVELOPING'],
    allowedWorkflowOperations: ['record-review-passed', 'record-review-failed', 'record-pr'],
    forbidden: { write: true },
  },
} as const

export const PRE_TOOL_USE_POLICY = {
  bashForbidden: {
    commands: ['gh pr create'],
  },
  isWriteAllowed: (_filePath: string, state: WorkflowState) => {
    return state.currentStateMachineState === 'DEVELOPING'
  },
} as const
```

That policy means a write is denied outside `DEVELOPING`.

`workflow-events.ts`

```ts
import { z } from 'zod'
import { STATE_NAME_SCHEMA } from './workflow-types'

const SESSION_STARTED_SCHEMA = z.object({
  type: z.literal('session-started'),
  at: z.string(),
  transcriptPath: z.string().optional(),
})

const TRANSITIONED_SCHEMA = z.object({
  type: z.literal('transitioned'),
  at: z.string(),
  from: STATE_NAME_SCHEMA,
  to: STATE_NAME_SCHEMA,
})

export const WORKFLOW_EVENT_SCHEMA = z.discriminatedUnion('type', [
  SESSION_STARTED_SCHEMA,
  TRANSITIONED_SCHEMA,
])

export type WorkflowEvent = z.infer<typeof WORKFLOW_EVENT_SCHEMA>
```

`fold.ts`

```ts
import type { WorkflowEvent } from './workflow-events'
import { INITIAL_STATE, type WorkflowState } from './workflow-types'

export function applyEvent(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  switch (event.type) {
    case 'session-started':
      return {
        ...state,
        ...(event.transcriptPath === undefined ? {} : { transcriptPath: event.transcriptPath }),
      }
    case 'transitioned':
      return {
        ...state,
        currentStateMachineState: event.to,
      }
  }
}

export function applyEvents(events: readonly WorkflowEvent[]): WorkflowState {
  return events.reduce(applyEvent, INITIAL_STATE)
}
```

`workflow.ts`

```ts
import {
  pass,
  type BaseEvent,
  type PreconditionResult,
  type RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { applyEvent } from './fold'
import { WORKFLOW_EVENT_SCHEMA, type WorkflowEvent } from './workflow-events'
import type { WorkflowState } from './workflow-types'

export type WorkflowDeps = { now: () => string }

export class Workflow implements RehydratableWorkflow<WorkflowState> {
  private pendingEvents: WorkflowEvent[] = []

  constructor(
    private state: WorkflowState,
    private readonly _deps: WorkflowDeps,
  ) {}

  getState(): WorkflowState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    const workflowEvent = WORKFLOW_EVENT_SCHEMA.parse(event)
    this.pendingEvents = [...this.pendingEvents, workflowEvent]
    this.state = applyEvent(this.state, workflowEvent)
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pendingEvents
  }

  startSession(transcriptPath: string): void {
    this.appendEvent({
      type: 'session-started',
      at: this._deps.now(),
      transcriptPath,
    })
  }

  getTranscriptPath(): string {
    return this.state.transcriptPath ?? ''
  }

  registerAgent(): PreconditionResult {
    return pass()
  }

  handleTeammateIdle(): PreconditionResult {
    return pass()
  }
}

export function createWorkflow(state: WorkflowState, deps: WorkflowDeps): Workflow {
  return new Workflow(state, deps)
}
```

`workflow-definition.ts`

```ts
import type {
  BaseEvent,
  WorkflowDefinition,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  createWorkflow,
  type Workflow,
  type WorkflowDeps,
} from './workflow'
import { applyEvent } from './fold'
import { WORKFLOW_EVENT_SCHEMA } from './workflow-events'
import {
  INITIAL_STATE,
  STATE_NAME_SCHEMA,
  type StateName,
  type WorkflowOperation,
  type WorkflowState,
} from './workflow-types'

export const WORKFLOW_DEFINITION: WorkflowDefinition<
  Workflow,
  WorkflowState,
  WorkflowDeps,
  StateName,
  WorkflowOperation
> = {
  fold: (state: WorkflowState, event: BaseEvent): WorkflowState => {
    const result = WORKFLOW_EVENT_SCHEMA.safeParse(event)
    if (!result.success) return state
    return applyEvent(state, result.data)
  },
  buildWorkflow: createWorkflow,
  stateSchema: STATE_NAME_SCHEMA,
  initialState: () => INITIAL_STATE,
  getRegistry: () => WORKFLOW_REGISTRY,
  buildTransitionContext: (state, from, to) => ({
    state,
    from,
    to,
    gitInfo: {
      currentBranch: 'main',
      workingTreeClean: true,
      headCommit: 'HEAD',
      changedFilesVsDefault: [],
      hasCommitsVsDefault: false,
    },
  }),
}
```

## Claude Code example

```ts
import { createClaudeCodeWorkflowCli } from '@nt-ai-lab/deterministic-agent-workflow-claude-code'
import { createDefaultProcessDeps } from '@nt-ai-lab/deterministic-agent-workflow-cli'

createClaudeCodeWorkflowCli({
  workflowDefinition: WORKFLOW_DEFINITION,
  routes: ROUTES,
  bashForbidden: PRE_TOOL_USE_POLICY.bashForbidden,
  isWriteAllowed: PRE_TOOL_USE_POLICY.isWriteAllowed,
  buildWorkflowDeps: (platform) => ({
    now: platform.now,
  }),
  processDeps: createDefaultProcessDeps(),
})
```

## Event store

The adapter creates the SQLite event store automatically.

- default path: `~/.workflow-events.db`
- override path: set `WORKFLOW_EVENTS_DB=/path/to/workflow-events.db`

That is the same database the Control Center reads.

## Control Center

The adapters write workflow events to `~/.workflow-events.db` by default.

Start the UI:

```bash
pnpm --filter deterministic-agent-workflows-control-center build:ui
pnpm --filter deterministic-agent-workflows-control-center start -- --db ~/.workflow-events.db --port 3120
```

Open `http://localhost:3120`

![Control Center](docs/control-center.png)

## References

- `examples/README.md`
- https://github.com/NTCoding/living-architecture/blob/main/tools/dev-workflow-v2/src/shell/opencode-plugin.ts
- https://github.com/NTCoding/autonomous-claude-agent-team
