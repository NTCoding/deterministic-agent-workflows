# deterministic-agent-workflows

Monorepo for deterministic agent workflow tooling.

## Core idea

- Define workflows as states + allowed operations.
- Engine enforces transitions and operation gates.
- Example: if session is in `PLANNING`, a write operation can be blocked until `DEVELOPING`.

## Packages (publish target)

- `@nt-ai-lab/deterministic-agent-workflow-engine`
- `@nt-ai-lab/deterministic-agent-workflow-dsl`
- `@nt-ai-lab/deterministic-agent-workflow-event-store`
- `@nt-ai-lab/deterministic-agent-workflow-claude-code`
- `@nt-ai-lab/deterministic-agent-workflow-opencode`

## Control Center UI

The Control Center shows sessions, current states, transitions, denials, and event history.

Start it:

```bash
pnpm --filter deterministic-agent-workflows-control-center build:ui
pnpm --filter deterministic-agent-workflows-control-center start -- --db /path/to/workflow-events.db --port 3120
```

Open: `http://localhost:3120`

Screenshot:

![Control Center](docs/control-center.png)
