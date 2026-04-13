---
'@nt-ai-lab/deterministic-agent-workflow-cli': patch
'@nt-ai-lab/deterministic-agent-workflow-dsl': patch
'@nt-ai-lab/deterministic-agent-workflow-engine': patch
'@nt-ai-lab/deterministic-agent-workflow-event-store': patch
'@nt-ai-lab/deterministic-agent-workflow-claude-code': patch
'@nt-ai-lab/deterministic-agent-workflow-opencode': patch
---

Republish packages using pnpm workspace publishing so internal workspace dependencies are rewritten correctly in the published package manifests.
