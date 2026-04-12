# control-center

## Purpose
Hosts non-published app UI and orchestration entrypoints.

## Canonical Example
`apps/deterministic-agent-workflows-control-center/src/**`

## Common Misclassifications
- Engine internals that should remain in `engine`.

## Anti-Patterns
- Importing from `dsl`, `claude-code`, or `opencode`.
