# Deterministic Agent Workflows — Actual Plan

## What “done” means

This repo is **not done** until a consumer can copy a short example like this shape and get a working integration:

```ts
const plugin = createOpenCodeWorkflowPlugin({
  workflowDefinition,
  routes,
  bashForbidden,
  isWriteAllowed,
  pluginRoot,
  commandDirectories,
  commandPrefix,
  buildWorkflowDeps,
})
```

Consumers must **not** need to implement low-level engine internals such as:
- `appendEvent`
- `getPendingEvents`
- custom rehydration
- manual event-store wiring for the normal adapter path
- ad hoc transcript reader plumbing

If docs or APIs force that, the repo is not ready.

---

## Target user experience

1. User installs:
   - `@nt-ai-lab/deterministic-agent-workflow-dsl`
   - one adapter: `@nt-ai-lab/deterministic-agent-workflow-opencode`, `@nt-ai-lab/deterministic-agent-workflow-claude-code`, `@nt-ai-lab/deterministic-agent-workflow-codex`, or `@nt-ai-lab/deterministic-agent-workflow-pi`
2. User defines workflow states, transitions, and policy.
3. User creates plugin via one high-level factory.
4. Runtime automatically:
   - enforces transitions
   - blocks forbidden writes/bash usage in the wrong state
   - records events
5. User opens Control Center and sees sessions, current states, transitions, denials, and event history.

---

## Non-negotiable product requirements

### Consumer API
- Provide `@nt-ai-lab/deterministic-agent-workflow-cli` for route definition and Claude Code process wiring.
- Provide `createOpenCodeWorkflowPlugin(...)`.
- Provide `createClaudeCodeWorkflowCli(...)`.
- Provide `createCodexWorkflowCli(...)`.
- Provide `createPiWorkflowExtension(...)`.
- Preserve the existing consumer setup shape exactly.
- Hide engine/event-sourcing internals behind adapter APIs.

### Docs
- README must explain:
  - what the product does
  - how to install it
  - one real copy-paste consumer example
  - how the Control Center is used
- No vague instructions such as “wire this into the engine.”
- No consumer docs that require implementing `RehydratableWorkflow` directly.

### Architecture
- Engine stays platform-agnostic.
- Provider-specific runtime logic stays in adapter packages.
- Pi uses the same linear workflow event model as the other providers. Tree navigation and forks are blocked after workflow start until branch-aware event streams are designed. Ephemeral `--no-session` runs fail closed because they provide no durable transcript.
- Event store package owns persistence implementation.
- Role-enforcement model stays aligned with `living-architecture`.
- If code does not fit role-enforcement conventions, stop and discuss with the user.

### Release
- Publish under `@nt-ai-lab`.
- Target package names:
  - `@nt-ai-lab/deterministic-agent-workflow-dsl`
  - `@nt-ai-lab/deterministic-agent-workflow-engine`
  - `@nt-ai-lab/deterministic-agent-workflow-cli`
  - `@nt-ai-lab/deterministic-agent-workflow-event-store`
  - `@nt-ai-lab/deterministic-agent-workflow-claude-code`
  - `@nt-ai-lab/deterministic-agent-workflow-opencode`
  - `@nt-ai-lab/deterministic-agent-workflow-codex`
  - `@nt-ai-lab/deterministic-agent-workflow-pi`

---

## Current reality

### Foundation that exists
- [x] Nx/pnpm workspace exists.
- [x] Core package/app directories exist.
- [x] Control Center app exists and can render a UI.
- [x] Role-enforcement files were copied from `living-architecture` and adapted.
- [x] Engine, DSL, event-store, and adapter code exists at a low level.
- [x] A dedicated CLI package now exists for route definitions and Claude Code wiring.

### Critical gaps
- [ ] Claude Code still needs the same level of consumer-proof validation now added for OpenCode.
- [x] Lint now passes against the full workspace.
- [x] `role-check` is re-enabled and passing.

---

## Execution plan

Status legend: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`

### 0) Lock the public API
- [x] **DONE** Define the exact public API for `createOpenCodeWorkflowPlugin(...)`.
- [x] **DONE** Define the exact public API for `createClaudeCodeWorkflowCli(...)`.
- [x] **DONE** Preserve the existing consumer interface exactly. This migration does not change the contract shape.
- [x] **DONE** Decide which types are public consumer-facing types versus advanced/internal types.
- [x] **DONE** Minimize required consumer inputs to workflow definition + policy + platform deps.

### 1) Hide engine internals behind adapter factories
- [x] **DONE** Implement OpenCode adapter factory that owns engine construction internally.
- [x] **DONE** Implement Claude Code wrapper that owns transcript-reader wiring internally.
- [x] **DONE** Move `RehydratableWorkflow`/event-application details out of normal consumer setup.
- [x] **DONE** Ensure normal consumers do not implement `appendEvent`, `getPendingEvents`, or rehydration plumbing in the documented adapter path.
- [x] **DONE** Ensure transcript reader setup is owned by adapters in the normal path.
- [x] **DONE** Ensure event-store setup is owned by adapters in the normal OpenCode path.

### 2) Define the right package responsibilities
- [ ] **TODO** Keep refining the package story so normal users start from `cli` + adapter + workflow definition, not engine internals.
- [x] **DONE** Make `engine` an advanced/core package, not the required first-touch package for normal users in README.
- [x] **DONE** Keep `event-store` as persistence implementation package, not a required manual step for normal OpenCode adapter setup.
- [x] **DONE** Keep provider-specific integration code inside its `claude-code`, `codex`, `opencode`, or `pi` adapter package.
- [ ] **TODO** Review exports in every package and remove accidental low-level leakage from adapter-facing docs.

### 3) Align package names and publish surface
- [x] **DONE** Update package names to final `@nt-ai-lab/deterministic-agent-workflow-*` names.
- [x] **DONE** Update workspace cross-package dependencies to the final names.
- [x] **DONE** Update exports/imports/docs/examples to the final names.
- [x] **DONE** Verify install commands in README match actual package names.

### 4) Produce one real end-to-end consumer example
- [x] **DONE** Create one short OpenCode example using the final plugin factory API.
- [x] **DONE** Example shows a blocked write in `PLANNING`.
- [x] **DONE** Example shows a successful write after transition to `DEVELOPING`.
- [x] **DONE** Example is copy-pasteable and does not require engine internals.
- [x] **DONE** API was fixed before rewriting the docs example.

### 5) Rewrite README around user value
- [x] **DONE** Rewrite README around: what it does, why it matters, how to use it.
- [x] **DONE** Add install section with final package names.
- [x] **DONE** Add real copy-paste examples using the high-level public APIs.
- [x] **DONE** Remove vague wording and low-level internal implementation details.
- [x] **DONE** Explain Control Center as a user feature: inspect sessions, states, transitions, denials.

### 6) Finish Control Center documentation
- [x] **DONE** Keep a working screenshot in `docs/control-center.png`.
- [x] **DONE** Document how to start Control Center against a workflow events database.
- [ ] **TODO** Verify the instructions from a clean checkout after final package cleanup.
- [x] **DONE** Make sure Control Center terminology matches the product language used in README.

### 7) Enforce architecture without damaging usability
- [ ] **TODO** Keep `.riviere` aligned with `living-architecture` role names and folder model.
- [ ] **TODO** Keep dependency-cruiser rules aligned with desired package boundaries.
- [ ] **TODO** Ensure adapter-factory implementation still fits role-enforcement conventions.
- [ ] **TODO** If a required consumer API does not fit the current role model cleanly, stop and discuss with the user before forcing a bad abstraction.

### 8) Validation gates
- [x] **DONE** Add a smoke test for the high-level OpenCode adapter factory.
- [x] **DONE** Add smoke test for blocked operation before allowed state.
- [x] **DONE** Add smoke test for allowed operation after transition.
- [ ] **TODO** Verify install, lint, typecheck, test, build from clean checkout.
- [x] **DONE** Re-enable and pass `role-check` once upstream packaging issue is resolved or a stable workaround is chosen.

### 9) Release readiness
- [ ] **TODO** Confirm package metadata, exports, and typings match the public API.
- [ ] **TODO** Confirm npm publish config matches `@nt-ai-lab`.
- [ ] **TODO** Confirm lockstep release flow works.
- [ ] **TODO** Do not mark release-ready until README example and smoke tests both pass.

### 10) Native Codex adapter
- [x] **DONE** Add project-configured Codex lifecycle hooks, session-scoped workflow commands, and enforcement.

### 11) Prevent premature user questions

- [x] **DONE** Treat user questions as stopping: block provider question tools unless the active state sets `allowIdle: true`.

### 12) Make sessions easier to find

- [x] **DONE** Show a dedicated, visibly headed Started date/time column in the Control Center session list. It must share a fixed grid with every session row, be sourced from the first `session-started` event, and be formatted in the viewer's local time.

### 13) Native Pi adapter

- [x] **DONE** Add a Pi extension factory with explicit workflow start, safe resumption of active workflows, workflow commands, tool enforcement after workflow start, stopping recovery, event persistence, and Control Center transcript support.
- [x] **DONE** Block Pi tree navigation and forks after workflow start so the linear workflow event stream cannot retain state from an abandoned branch.

### 14) Distinguish automatic stop prevention responses

- [x] **DONE** Mark stop prevention messages as automatic workflow hook responses, make their lack of user approval explicit, tell blocked agents how to request assistance, and allow consumers to append project specific instructions.

---

## Acceptance criteria for “done”

This repo is only ready when all of the following are true:

- A consumer can create an OpenCode integration with one high-level factory.
- A consumer can create a Claude Code integration with the preserved high-level CLI wrapper.
- A consumer can create a Codex integration with automatic lifecycle hooks and explicit session-scoped workflow commands.
- A consumer can create a Pi integration with one high-level extension factory.
- Pi sessions resume safely, and unsupported tree navigation and forks fail closed after workflow start.
- The main README shows that exact usage style.
- The README example does not mention `appendEvent`, `getPendingEvents`, `RehydratableWorkflow`, or manual event rehydration.
- A smoke test proves:
  - blocked write in `PLANNING`
  - allowed write in `DEVELOPING`
- Control Center instructions work and the screenshot matches reality.
- Package names/docs/exports all match the final `@nt-ai-lab` publish targets.

---

## Agent rule

If an implementation forces consumers into low-level engine/event-sourcing internals, stop and discuss with the user before proceeding.
