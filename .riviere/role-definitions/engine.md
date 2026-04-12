# engine

## Purpose
Defines provider-agnostic workflow execution behavior.

## Canonical Example
`packages/deterministic-agent-workflows-engine/src/**`

## Common Misclassifications
- Provider adapter code that should be in `claude-code` or `opencode`.

## Anti-Patterns
- Importing from `claude-code`, `opencode`, or control-center app code.
