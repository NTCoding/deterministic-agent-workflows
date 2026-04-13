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

`workflow-types.ts`

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

export type WorkflowState = { currentStateMachineState: StateName }
```

`workflow.ts`

```ts
import {
  pass,
  type BaseEvent,
  type PreconditionResult,
  type RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { STATE_NAME_SCHEMA, type WorkflowState } from './workflow-types'

export type WorkflowDeps = { now: () => string }

export class Workflow implements RehydratableWorkflow<WorkflowState> {
  private readonly pendingEvents: BaseEvent[] = []
  private transcriptPath = ''

  constructor(
    private state: WorkflowState,
    private readonly _deps: WorkflowDeps,
  ) {}

  getState(): WorkflowState {
    return this.state
  }

  appendEvent(event: BaseEvent): void {
    this.pendingEvents.push(event)
    if (event.type === 'transitioned' && typeof event.to === 'string') {
      this.state = { currentStateMachineState: STATE_NAME_SCHEMA.parse(event.to) }
    }
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pendingEvents
  }

  startSession(transcriptPath: string): void {
    this.transcriptPath = transcriptPath
  }

  getTranscriptPath(): string {
    return this.transcriptPath
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
import { z } from 'zod'
import {
  createWorkflow,
  type Workflow,
  type WorkflowDeps,
} from './features/workflow/domain/workflow'
import type { WorkflowState } from './features/workflow/domain/workflow-types'
import type {
  WorkflowDefinition,
  BaseEvent,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  WorkflowRegistry,
  TransitionContext,
} from '@nt-ai-lab/deterministic-agent-workflow-dsl'

export const STATE_NAME_SCHEMA = z.enum(['PLANNING', 'DEVELOPING', 'REVIEWING'])

export type StateName = z.infer<typeof STATE_NAME_SCHEMA>
export type WorkflowOperation =
  | 'record-plan'
  | 'record-branch'
  | 'record-implementation-progress'
  | 'record-review-passed'
  | 'record-review-failed'
  | 'record-pr'

export const WORKFLOW_REGISTRY: WorkflowRegistry<WorkflowState, StateName, WorkflowOperation> = {
  PLANNING: {
    emoji: '🧠',
    agentInstructions: 'Plan only',
    canTransitionTo: ['DEVELOPING'],
    allowedWorkflowOperations: ['record-plan'],
    forbidden: { write: true },
  },
  DEVELOPING: {
    emoji: '🛠️',
    agentInstructions: 'Implement changes',
    canTransitionTo: ['REVIEWING'],
    allowedWorkflowOperations: ['record-branch', 'record-implementation-progress'],
  },
  REVIEWING: {
    emoji: '🔍',
    agentInstructions: 'Review before merge',
    canTransitionTo: ['DEVELOPING'],
    allowedWorkflowOperations: ['record-review-passed', 'record-review-failed', 'record-pr'],
    forbidden: { write: true },
  },
}

export const WORKFLOW_DEFINITION: WorkflowDefinition<
  Workflow,
  WorkflowState,
  WorkflowDeps,
  StateName,
  WorkflowOperation
> = {
  stateSchema: STATE_NAME_SCHEMA,
  initialState: () => ({ currentStateMachineState: 'PLANNING' }),
  buildWorkflow: createWorkflow,
  fold: (state, event: BaseEvent) => {
    if (event.type === 'transitioned' && typeof event.to === 'string') {
      return { currentStateMachineState: STATE_NAME_SCHEMA.parse(event.to) }
    }
    return state
  },
  getRegistry: () => WORKFLOW_REGISTRY,
  buildTransitionContext: (
    state,
    from,
    to,
  ): TransitionContext<WorkflowState, StateName> => ({
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

export const PRE_TOOL_USE_POLICY = {
  bashForbidden: {
    commands: ['gh pr create'],
  },
  isWriteAllowed: (filePath: string, state: WorkflowState) => {
    return state.currentStateMachineState === 'DEVELOPING'
  },
} as const
```

That policy means a write is denied outside `DEVELOPING`.

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
