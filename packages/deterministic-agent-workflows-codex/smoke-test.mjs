import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
const originalHome = process.env.HOME
process.env.HOME = root
const resolvedSessionIds = []
const workflowNow = () => '2026-08-20T15:00:00.000Z'

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
      emoji: '🛠️',
      agentInstructions: '',
      allowIdle: true,
      canTransitionTo: [],
      allowedWorkflowOperations: ['record-note'],
      forbidden: { write: false },
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
      init: { type: 'session-start' },
      transition: { type: 'transition', args: [arg.state('STATE', stateSchema)] },
      'record-note': { type: 'transaction', args: [arg.string('NOTE')], handler: (workflow) => workflow.recordNote() },
    },
    bashForbidden: { commands: ['git push'] },
    isWriteAllowed: () => false,
    customGates: [{
      name: 'forbid-private',
      check: (workflow, context) => {
        if (context.toolName === 'request_user_input' && workflow.getState().currentStateMachineState === 'PLANNING') {
          return 'planning questions are disabled by a custom gate'
        }
        return context.filePath === 'private.txt' ? 'private paths are forbidden' : true
      },
    }],
    workflowCommand: 'node ./workflow-codex.mjs',
    workflowRoot: root,
    stopPreventionMessage: 'Follow the project recovery procedure.',
    now: workflowNow,
    processDeps: {
      getEnv: (name) => name === 'HOME' ? root : name === 'WORKFLOW_EVENTS_DB' ? databasePath : undefined,
      getArgv: () => ['node', 'workflow-codex.mjs', ...args],
      readFile: (path) => path === '/dev/stdin' ? JSON.stringify(hook) : '',
      appendToFile: () => undefined,
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
  const now = new Date(workflowNow())
  const directSessionDirectory = join(
    root,
    '.codex',
    'sessions',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  )
  const directTranscriptPath = join(directSessionDirectory, 'rollout-smoke-direct-command.jsonl')
  mkdirSync(directSessionDirectory, { recursive: true })
  writeFileSync(directTranscriptPath, '')

  const directInit = invoke({ args: ['init', 'direct-command'] })
  assert.equal(directInit.exitCode, 0, directInit.stderr)
  assert.equal(resolvedSessionIds.at(-1), 'direct-command')
  const directSessionEvents = createStore(databasePath).readEvents('direct-command')
  assert.equal(directSessionEvents[0].payload.transcriptPath, directTranscriptPath)
  assert.equal(directSessionEvents[0].payload.repository, 'NTCoding/deterministic-agent-workflows')

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

  const customGate = invoke({
    hook: {
      session_id: 'one',
      transcript_path: null,
      cwd: root,
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Update File: private.txt\n*** End Patch' },
    }
  })
  assert.match(customGate.stdout, /private paths are forbidden/)

  const blockedQuestion = invoke({
    hook: {
      session_id: 'one',
      transcript_path: null,
      cwd: root,
      hook_event_name: 'PreToolUse',
      tool_name: 'request_user_input',
      tool_input: {},
    }
  })
  assert.match(blockedQuestion.stdout, /permissionDecision":"deny"/)
  assert.match(blockedQuestion.stdout, /planning questions are disabled by a custom gate/)

  const stop = invoke({
    hook: {
      session_id: 'one',
      transcript_path: null,
      cwd: root,
      hook_event_name: 'Stop'
    }
  })
  assert.equal(JSON.parse(stop.stdout).decision, 'block')
  assert.match(JSON.parse(stop.stdout).reason, /^\[Automatic Workflow Hook Response\]/)
  assert.match(JSON.parse(stop.stdout).reason, /The user has not seen this/)
  assert.match(JSON.parse(stop.stdout).reason, /Workflow state PLANNING does not allow stopping/)
  assert.match(JSON.parse(stop.stdout).reason, /Follow the project recovery procedure\.$/)

  const transition = invoke({ args: ['transition', 'one', 'DEVELOPING'] })
  assert.equal(transition.exitCode, 0)
  assert.equal(resolvedSessionIds.at(-1), 'one')

  const customOperation = invoke({ args: ['record-note', 'one', 'done'] })
  assert.equal(customOperation.exitCode, 0)
  assert.equal(resolvedSessionIds.at(-1), 'one')

  const allowedWrite = invoke({
    hook: {
      session_id: 'one',
      transcript_path: null,
      cwd: root,
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch' },
    }
  })
  assert.equal(allowedWrite.exitCode, 0)
  assert.equal(allowedWrite.stdout, '')

  const allowedQuestion = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'request_user_input', tool_input: {},
  } })
  assert.equal(allowedQuestion.exitCode, 0)
  assert.equal(allowedQuestion.stdout, '')

  const blockedBash = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
  } })
  assert.match(blockedBash.stdout, /permissionDecision":"deny"/)

  const subagent = invoke({ hook: {
    session_id: 'one', transcript_path: null, cwd: root, hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'reviewer',
  } })
  assert.equal(subagent.exitCode, 0)

  invoke({ hook: { session_id: 'two', transcript_path: transcriptPath, cwd: process.cwd(), hook_event_name: 'SessionStart' } })
  const isolated = invoke({ hook: {
    session_id: 'two', transcript_path: null, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: src/other.ts\n*** End Patch' },
  } })
  assert.match(isolated.stdout, /permissionDecision":"deny"/)
} finally {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(root, { recursive: true, force: true })
}
