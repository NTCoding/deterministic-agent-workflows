# deterministic-agent-workflows

Build deterministic workflows for coding agents.

## What this is

- Define workflow states and legal transitions.
- Enforce rules at runtime.
- Block unsafe actions outside allowed states.

Example: when a session is in `PLANNING`, `Write` can be denied until state changes to `DEVELOPING`.

## Getting started

1. Install packages (publish targets):

```bash
pnpm add @nt-ai-lab/deterministic-agent-workflow-dsl
pnpm add @nt-ai-lab/deterministic-agent-workflow-engine
pnpm add @nt-ai-lab/deterministic-agent-workflow-event-store
# pick one adapter
pnpm add @nt-ai-lab/deterministic-agent-workflow-claude-code
# or
pnpm add @nt-ai-lab/deterministic-agent-workflow-opencode
```

2. Define your rules (example):

```ts
import {
  checkOperationGate,
  type WorkflowRegistry,
} from '@nt-ai-lab/deterministic-agent-workflow-dsl'

type StateName = 'PLANNING' | 'DEVELOPING'
type Operation = 'write-file' | 'record-plan'
type WorkflowState = { currentStateMachineState: StateName }

const registry: WorkflowRegistry<WorkflowState, StateName, Operation> = {
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
    canTransitionTo: ['PLANNING'],
    allowedWorkflowOperations: ['record-plan', 'write-file'],
  },
}

const state: WorkflowState = { currentStateMachineState: 'PLANNING' }

const blocked = checkOperationGate('write-file', state, registry)
console.log(blocked)
// { pass: false, reason: 'write-file is not allowed in state PLANNING.' }

const allowed = checkOperationGate('record-plan', state, registry)
console.log(allowed)
// { pass: true }
```

3. Wire this into the engine + adapter for runtime enforcement.
4. Write events to `workflow-events.db`.
5. Open Control Center to see states, transitions, and blocked operations.

## Control Center

```bash
pnpm --filter deterministic-agent-workflows-control-center build:ui
pnpm --filter deterministic-agent-workflows-control-center start -- --db /path/to/workflow-events.db --port 3120
```

Open: `http://localhost:3120`

![Control Center](docs/control-center.png)

## Example references

- `examples/README.md`
- https://github.com/NTCoding/living-architecture/blob/main/tools/dev-workflow-v2/src/shell/opencode-plugin.ts
- https://github.com/NTCoding/autonomous-claude-agent-team
