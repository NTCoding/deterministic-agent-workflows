import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { pass } from '../deterministic-agent-workflows-engine/dist/index.js'
import { createStore } from '../deterministic-agent-workflows-event-store/dist/index.js'
import { createClaudeCodeWorkflowCli } from './dist/index.js'

const root = mkdtempSync(join(tmpdir(), 'daw-claude-code-smoke-'))
const databasePath = join(root, 'workflow-events.db')
const transcriptPath = join(root, 'transcript.jsonl')
writeFileSync(transcriptPath, '')

class Workflow {
  constructor(state) {
    this.state = state
  }

  getState() { return this.state }
  getPendingEvents() { return [] }
  getTranscriptPath() { return this.state.transcriptPath }
  appendEvent() { return undefined }
  startSession() { return undefined }
  registerAgent() { return pass() }
  handleTeammateIdle() { return pass() }
}

function createDefinition(allowIdle) {
  return {
    initialState: () => ({
      currentStateMachineState: 'PLANNING',
      transcriptPath: ''
    }),
    stateSchema: z.literal('PLANNING'),
    fold: (state, event) => event.type === 'session-started'
      ? {
        ...state,
        transcriptPath: event.transcriptPath
      }
      : state,
    buildWorkflow: (state) => new Workflow(state),
    getRegistry: () => ({
      PLANNING: {
        emoji: '🧭',
        agentInstructions: '',
        allowIdle,
        canTransitionTo: [],
        allowedWorkflowOperations: [],
      },
    }),
    buildTransitionContext: (state, from, to) => ({
      state,
      from,
      to,
      gitInfo: {
        currentBranch: 'main',
        workingTreeClean: true,
        headCommit: 'abc',
        changedFilesVsDefault: [],
        hasCommitsVsDefault: false
      },
    }),
  }
}

function seedSession(sessionId) {
  createStore(databasePath).appendEvents(sessionId, [{
    envelope: {
      type: 'session-started',
      at: '2026-08-31T00:00:00.000Z',
      state: 'PLANNING'
    },
    payload: {
      transcriptPath,
      repository: 'test/repo',
      currentState: 'PLANNING',
      states: ['PLANNING']
    },
  }])
}

function invokeHook(sessionId, allowIdle, hookEventName = 'PreToolUse') {
  let stdout = ''
  let exitCode
  createClaudeCodeWorkflowCli({
    workflowDefinition: createDefinition(allowIdle),
    routes: {},
    bashForbidden: { commands: [] },
    isWriteAllowed: () => true,
    customGates: [{
      name: 'block-planning-questions',
      check: (_workflow, context) => !allowIdle && context.toolName === 'AskUserQuestion'
        ? 'planning questions are disabled by a custom gate'
        : true,
    }],
    stopPreventionMessage: 'Follow the Claude Code recovery procedure.',
    buildWorkflowDeps: () => ({}),
    processDeps: {
      getEnv: (name) => ({
        CLAUDE_PLUGIN_ROOT: root,
        CLAUDE_SESSION_ID: sessionId,
        HOME: root,
        WORKFLOW_EVENTS_DB: databasePath,
      })[name],
      exit: (code) => { exitCode = code },
      writeStdout: (value) => { stdout += value },
      writeStderr: () => undefined,
      getArgv: () => ['node', 'workflow-claude.mjs'],
      readFile: (path) => path === '/dev/stdin'
        ? JSON.stringify({
          session_id: sessionId,
          transcript_path: transcriptPath,
          cwd: root,
          hook_event_name: hookEventName,
          tool_name: 'AskUserQuestion',
          tool_input: {},
          tool_use_id: 'question-1',
        })
        : '',
      appendToFile: () => undefined,
      buildStore: (path) => createStore(path),
    },
  })
  return {
    stdout,
    exitCode
  }
}

try {
  seedSession('blocked')
  const blocked = invokeHook('blocked', false)
  assert.equal(blocked.exitCode, 2)
  assert.match(blocked.stdout, /planning questions are disabled by a custom gate/)

  seedSession('allowed')
  const stop = invokeHook('blocked', false, 'Stop')
  assert.equal(stop.exitCode, 0)
  assert.match(JSON.parse(stop.stdout).reason, /^\[Automatic Workflow Hook Response\]/)
  assert.match(JSON.parse(stop.stdout).reason, /The user has not seen this/)
  assert.match(JSON.parse(stop.stdout).reason, /Workflow state PLANNING does not allow stopping/)
  assert.match(JSON.parse(stop.stdout).reason, /Follow the Claude Code recovery procedure\.$/)

  const allowed = invokeHook('allowed', true)
  assert.equal(allowed.exitCode, 0)
  assert.equal(allowed.stdout, '')
} finally {
  rmSync(root, {
    recursive: true,
    force: true
  })
}
