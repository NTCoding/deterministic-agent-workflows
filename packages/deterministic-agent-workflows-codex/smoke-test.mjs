import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { arg } from '../deterministic-agent-workflows-cli/dist/index.js'
import { pass } from '../deterministic-agent-workflows-engine/dist/index.js'
import { createStore } from '../deterministic-agent-workflows-event-store/dist/index.js'
import { createCodexWorkflowCli } from './dist/index.js'

const root = mkdtempSync(join(tmpdir(), 'daw-codex-smoke-'))
const databasePath = join(root, 'workflow-events.db')
const transcriptPath = join(root, 'transcript.jsonl')
writeFileSync(transcriptPath, '')
const resolvedSessionIds = []

class Workflow {
  constructor(state) {
    this.state = state
    this.pendingEvents = []
  }

  getState() { return this.state }
  getPendingEvents() { return this.pendingEvents }
  getTranscriptPath() { return this.state.transcriptPath }
  registerAgent() { return pass() }
  handleTeammateIdle() { return pass() }
  recordNote() { return pass() }

  appendEvent(event) {
    this.pendingEvents.push(event)
    this.state = fold(this.state, event)
  }

  startSession(transcriptPath, repository) {
    this.appendEvent({
      type: 'session-started',
      at: '2026-08-12T00:00:00Z',
      transcriptPath,
      repository,
      currentState: this.state.currentStateMachineState,
      states: [this.state.currentStateMachineState],
    })
  }
}

function fold(state, event) {
  if (event.type === 'transitioned') {
    return { ...state, currentStateMachineState: event.to }
  }
  if (event.type === 'session-started') {
    return { ...state, transcriptPath: event.transcriptPath }
  }
  return state
}

const stateSchema = z.enum(['PLANNING', 'DEVELOPING'])
const definition = {
  initialState: () => ({ currentStateMachineState: 'PLANNING', transcriptPath: '' }),
  stateSchema,
  fold,
  buildWorkflow: (state) => new Workflow(state),
  getRegistry: () => ({
    PLANNING: {
      emoji: '📝', agentInstructions: '', canTransitionTo: ['DEVELOPING'], allowedWorkflowOperations: [], forbidden: { write: true },
    },
    DEVELOPING: {
      emoji: '🛠️', agentInstructions: '', canTransitionTo: [], allowedWorkflowOperations: ['record-note'], forbidden: { write: false },
    },
  }),
  buildTransitionContext: (state, from, to) => ({
    state,
    from,
    to,
    gitInfo: { currentBranch: 'main', workingTreeClean: true, headCommit: 'abc', changedFilesVsDefault: [], hasCommitsVsDefault: true },
  }),
}

function invoke({ args = [], hook }) {
  let stdout = ''
  let stderr = ''
  let exitCode
  createCodexWorkflowCli({
    workflowDefinition: definition,
    routes: {
      transition: { type: 'transition', args: [arg.state('STATE', stateSchema)] },
      'record-note': { type: 'transaction', args: [arg.string('NOTE')], handler: (workflow) => workflow.recordNote() },
    },
    bashForbidden: { commands: ['git push'] },
    isWriteAllowed: () => false,
    customGates: [{
      name: 'forbid-private',
      check: (_workflow, context) => context.filePath === 'private.txt' ? 'private paths are forbidden' : true,
    }],
    workflowCommand: 'node ./workflow-codex.mjs',
    workflowRoot: root,
    processDeps: {
      getEnv: (name) => name === 'HOME' ? root : name === 'WORKFLOW_EVENTS_DB' ? databasePath : undefined,
      getArgv: () => ['node', 'workflow-codex.mjs', ...args],
      readFile: (path) => path === '/dev/stdin' ? JSON.stringify(hook) : '',
      appendToFile: () => {},
      buildStore: (path) => createStore(path),
      writeStdout: (value) => { stdout += value },
      writeStderr: (value) => { stderr += value },
      exit: (code) => { exitCode = code },
    },
    buildWorkflowDeps: (platform) => {
      resolvedSessionIds.push(platform.getSessionId())
      return {}
    },
  })
  return { stdout, stderr, exitCode }
}

try {
  const start = invoke({ hook: { session_id: 'one', transcript_path: transcriptPath, cwd: process.cwd(), hook_event_name: 'SessionStart' } })
  assert.equal(start.exitCode, 0)
  assert.match(start.stdout, /Workflow session: one/)
  assert.match(start.stdout, /transition one <STATE>/)

  const blockedWrite = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch' },
  } })
  assert.equal(blockedWrite.exitCode, 0)
  assert.match(blockedWrite.stdout, /permissionDecision":"deny"/)

  const customGate = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: private.txt\n*** End Patch' },
  } })
  assert.match(customGate.stdout, /private paths are forbidden/)

  const transition = invoke({ args: ['transition', 'one', 'DEVELOPING'] })
  assert.equal(transition.exitCode, 0)
  assert.equal(resolvedSessionIds.at(-1), 'one')

  const customOperation = invoke({ args: ['record-note', 'one', 'done'] })
  assert.equal(customOperation.exitCode, 0)
  assert.equal(resolvedSessionIds.at(-1), 'one')

  const allowedWrite = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch' },
  } })
  assert.equal(allowedWrite.exitCode, 0)
  assert.equal(allowedWrite.stdout, '')

  const blockedBash = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
  } })
  assert.match(blockedBash.stdout, /permissionDecision":"deny"/)

  const subagent = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'reviewer',
  } })
  assert.equal(subagent.exitCode, 0)

  const stop = invoke({ hook: { session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'Stop' } })
  assert.deepEqual(JSON.parse(stop.stdout), {
    decision: 'block',
    reason: 'Workflow state DEVELOPING does not allow stopping.',
  })

  invoke({ hook: { session_id: 'two', transcript_path: transcriptPath, cwd: process.cwd(), hook_event_name: 'SessionStart' } })
  const isolated = invoke({ hook: {
    session_id: 'two', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: src/other.ts\n*** End Patch' },
  } })
  assert.match(isolated.stdout, /permissionDecision":"deny"/)
} finally {
  rmSync(root, { recursive: true, force: true })
}
