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
  appendEvent() {}
  startSession() {}
  registerAgent() { return pass() }
  handleTeammateIdle() { return pass() }
}

function createDefinition(allowIdle) {
  return {
    initialState: () => ({ currentStateMachineState: 'PLANNING', transcriptPath: '' }),
    stateSchema: z.literal('PLANNING'),
    fold: (state, event) => event.type === 'session-started'
      ? { ...state, transcriptPath: event.transcriptPath }
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
      gitInfo: { currentBranch: 'main', workingTreeClean: true, headCommit: 'abc', changedFilesVsDefault: [], hasCommitsVsDefault: false },
    }),
  }
}

function seedSession(sessionId) {
  createStore(databasePath).appendEvents(sessionId, [{
    envelope: { type: 'session-started', at: '2026-08-31T00:00:00.000Z', state: 'PLANNING' },
    payload: { transcriptPath, repository: 'test/repo', currentState: 'PLANNING', states: ['PLANNING'] },
  }])
}

function invokeQuestion(sessionId, allowIdle) {
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
      writeStderr: () => {},
      getArgv: () => ['node', 'workflow-claude.mjs'],
      readFile: (path) => path === '/dev/stdin'
        ? JSON.stringify({
          session_id: sessionId,
          transcript_path: transcriptPath,
          cwd: root,
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: {},
          tool_use_id: 'question-1',
        })
        : '',
      appendToFile: () => {},
      buildStore: (path) => createStore(path),
    },
  })
  return { stdout, exitCode }
}

try {
  seedSession('blocked')
  const blocked = invokeQuestion('blocked', false)
  assert.equal(blocked.exitCode, 2)
  assert.match(blocked.stdout, /planning questions are disabled by a custom gate/)

  seedSession('allowed')
  const allowed = invokeQuestion('allowed', true)
  assert.equal(allowed.exitCode, 0)
  assert.equal(allowed.stdout, '')
} finally {
  rmSync(root, { recursive: true, force: true })
}
