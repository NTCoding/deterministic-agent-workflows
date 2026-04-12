# Deterministic Agent Workflows — Migration and Execution Plan

## Purpose
Build a robust Nx monorepo for npm publication, migrating validated PoC logic from `../autonomous-claude-agent-team` into a clean, maintainable architecture.

## Finalized Requirements

### Repository and standards
- Repository target name: `deterministic-agent-workflows` (correct spelling).
- Follow `../living-architecture` Nx monorepo approach.
- Keep lint model aligned with `living-architecture`.
- Add and enforce `.riviere/role-enforcement.config.ts` with adapted rules for this repo domain.
- Consume `riviere-role-enforcement` from npm (external dependency, not vendored workspace package).

### Runtime/toolchain baselines
- Node.js: latest active LTS.
- TypeScript: 6.x baseline.

### Source migration scope
- Migrate only from PoC:
  - `packages/agentic-workflow-builder`
  - `packages/workflow-control-center`
- Do not migrate PoC root `src/`.

### v1 package/app set
Publishable packages:
1. `@nick-tune/deterministic-agent-workflows-dsl`
2. `@nick-tune/deterministic-agent-workflows-engine`
3. `@nick-tune/deterministic-agent-workflows-event-store`
4. `@nick-tune/deterministic-agent-workflows-claude-code`
5. `@nick-tune/deterministic-agent-workflows-opencode`

Non-published app:
- `apps/deterministic-agent-workflows-control-center`

### Architecture constraints
- Engine must be platform-agnostic.
- Claude/OpenCode-specific implementation must live in adapter packages only.
- Engine must be decoupled from CLI concerns.
- Event-store implementation lives in dedicated `event-store` package.
- Adapters depend on `engine + event-store`, not on `dsl`.
- DSL is abstraction layer that compiles/translates to engine language/contracts.

### Release strategy
- Lockstep versioning across all publishable packages for v1.

### Agent instruction files
- Root `AGENTS.md` is required.
- Root `CLAUDE.md` must instruct agents to read `AGENTS.md` first.

### Examples
- Add examples placeholder only (no full example implementation yet).
- Initial references:
  - `https://github.com/NTCoding/living-architecture/blob/main/tools/dev-workflow-v2/src/shell/opencode-plugin.ts`
  - `https://github.com/NTCoding/autonomous-claude-agent-team`

---

## Dependency Direction to Enforce

Package-level architecture rules:
- `dsl -> engine`
- `event-store -> engine`
- `claude-code -> engine`
- `claude-code -> event-store`
- `opencode -> engine`
- `opencode -> event-store`
- `apps/deterministic-agent-workflows-control-center -> engine`
- `apps/deterministic-agent-workflows-control-center -> event-store`

Forbidden directions:
- `engine -> claude-code`
- `engine -> opencode`
- `engine -> app`
- `event-store -> claude-code`
- `event-store -> opencode`
- `claude-code -> dsl`
- `opencode -> dsl`

These rules will be implemented using simple dependency-cruiser constraints.

---

## Execution Todo List (Track Progress Here)

Status legend: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`

### 0) Program setup and governance
- [x] **DONE** Confirm and document baseline versions (Node LTS exact major, TS 6 exact minor) in root docs.
- [x] **DONE** Add root `AGENTS.md`.
- [x] **DONE** Add root `CLAUDE.md` with “Read AGENTS.md first”.
- [x] **DONE** Update repository naming/documentation references to `deterministic-agent-workflows`.

### 1) Workspace bootstrap (Nx + pnpm)
- [x] **DONE** Initialize/normalize Nx workspace structure (`packages/*`, `apps/*`).
- [x] **DONE** Align root configs with `living-architecture` patterns:
  - `nx.json`
  - `pnpm-workspace.yaml`
  - `tsconfig.base.json`
  - `tsconfig.json`
  - `eslint.config.mjs`
  - `commitlint.config.mjs`
- [x] **DONE** Wire root scripts/targets for `lint`, `typecheck`, `test`, `build`, `role-check`.

### 2) Role-enforcement integration
- [x] **DONE** Add external npm dependency for role enforcement.
- [x] **DONE** Add `.riviere/role-enforcement.config.ts` adapted to this repo package boundaries.
- [x] **DONE** Add `.riviere/roles.ts` adapted role model.
- [x] **DONE** Add `.riviere/role-definitions/*` docs for adapted roles.
- [ ] **TODO** Integrate `role-check` into quality pipeline and CI.

### 3) Project scaffolding (packages/apps)
- [ ] **TODO** Scaffold `packages/deterministic-agent-workflows-engine`.
- [ ] **TODO** Scaffold `packages/deterministic-agent-workflows-dsl`.
- [ ] **TODO** Scaffold `packages/deterministic-agent-workflows-event-store`.
- [ ] **TODO** Scaffold `packages/deterministic-agent-workflows-claude-code`.
- [ ] **TODO** Scaffold `packages/deterministic-agent-workflows-opencode`.
- [ ] **TODO** Scaffold `apps/deterministic-agent-workflows-control-center` (non-published).
- [ ] **TODO** Configure package metadata (`name`, `exports`, `types`, `files`, publish config).

### 4) Migration and decomposition from PoC
- [ ] **TODO** Migrate domain logic from PoC `agentic-workflow-builder` into target package boundaries.
- [ ] **TODO** Move provider-specific code out of engine into `claude-code` and `opencode`.
- [ ] **TODO** Move event-store implementation into dedicated package.
- [ ] **TODO** Ensure engine has no provider or CLI coupling.
- [ ] **TODO** Migrate control center app from PoC `workflow-control-center`.
- [ ] **TODO** Exclude all transient artifacts (`coverage`, `dist`, `node_modules`, temp/runtime outputs).

### 5) Architecture guardrails (dep-cruiser + lint)
- [ ] **TODO** Add dependency-cruiser config for package-level rules listed above.
- [ ] **TODO** Add lint rule parity with `living-architecture` (including custom rules where required).
- [ ] **TODO** Enforce no forbidden package imports via CI checks.

### 6) Validation and hardening
- [ ] **TODO** Restore and pass typecheck for all packages/apps.
- [ ] **TODO** Restore and pass tests for all packages/apps.
- [ ] **TODO** Set and enforce coverage thresholds.
- [ ] **TODO** Verify role-check, dep-cruiser, lint, typecheck, test, build from clean install.

### 7) Release pipeline
- [ ] **TODO** Configure lockstep release strategy for publishable packages.
- [ ] **TODO** Configure npm publish workflow (dry-run first).
- [ ] **TODO** Add CI workflow for PR quality gates + release prerequisites.

### 8) Examples placeholder
- [ ] **TODO** Add `examples/README.md` placeholder.
- [ ] **TODO** Include reference links to first consumer and original PoC.

### 9) Final readiness gate
- [ ] **TODO** Run end-to-end parity check versus PoC behavior.
- [ ] **TODO** Confirm publishable package integrity (`exports`, typings, dependency graph).
- [ ] **TODO** Mark migration complete and ready for first lockstep release.

---

## Suggested Task Order for Agents
1. Section 0
2. Section 1
3. Section 2
4. Section 3
5. Section 4
6. Section 5
7. Section 6
8. Section 7
9. Section 8
10. Section 9

---

## Out of Scope (until explicitly approved)
- Major feature redesign beyond migration and decomposition.
- Publishing the control center app.
- Full example implementations (placeholder only in v1).
