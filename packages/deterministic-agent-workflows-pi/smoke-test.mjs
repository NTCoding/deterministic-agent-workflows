import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { arg } from '../deterministic-agent-workflows-cli/dist/index.js'
import { pass } from '../deterministic-agent-workflows-engine/dist/index.js'
import { createStore } from '../deterministic-agent-workflows-event-store/dist/index.js'
import {
  createPiWorkflowExtension,
  PI_IDLE_RECOVERY_MESSAGE,
  PI_SESSION_BRANCH_BLOCK_MESSAGE,
} from './dist/index.js'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const pluginRoot = mkdtempSync(join(tmpdir(), 'daw-pi-smoke-'))
const databasePath = join(pluginRoot, 'workflow-events.db')
const sessionFile = join(pluginRoot, 'pi-session.jsonl')
const stateSchema = z.enum(['PLANNING', 'DEVELOPING'])

class Workflow {
  constructor(state) {
    this.state = state
    this.pendingEvents = []
  }

  getState() { return this.state }
  getTranscriptPath() { return this.state.transcriptPath }
  getPendingEvents() { return this.pendingEvents.splice(0) }
  registerAgent() { return pass() }
  handleTeammateIdle() { return pass() }

  appendEvent(event) {
    this.pendingEvents.push(event)
    this.state = fold(this.state, event)
  }

  startSession(transcriptPath, repository) {
    this.appendEvent({
      type: 'session-started',
      at: '2026-09-03T12:00:00.000Z',
      transcriptPath,
      repository,
    })
  }

  recordNote(note) {
    this.appendEvent({
      type: 'note-recorded',
      at: '2026-09-03T12:01:00.000Z',
      note,
    })
    return pass()
  }
}

function fold(state, event) {
  if (event.type === 'session-started') return {
    ...state,
    transcriptPath: event.transcriptPath,
  }
  if (event.type === 'transitioned') return {
    ...state,
    currentStateMachineState: event.to,
  }
  if (event.type === 'note-recorded') return {
    ...state,
    notes: [...state.notes, event.note],
  }
  return state
}

const workflowDefinition = {
  initialState: () => ({
    currentStateMachineState: 'PLANNING',
    transcriptPath: '',
    notes: [],
  }),
  stateSchema,
  fold,
  buildWorkflow: (state) => new Workflow(state),
  getRegistry: () => ({
    PLANNING: {
      emoji: 'PLAN',
      agentInstructions: 'states/planning.md',
      canTransitionTo: ['DEVELOPING'],
      allowedWorkflowOperations: [],
      forbidden: { write: true },
    },
    DEVELOPING: {
      emoji: 'BUILD',
      agentInstructions: 'states/developing.md',
      allowIdle: true,
      canTransitionTo: [],
      allowedWorkflowOperations: ['record-note'],
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
      hasCommitsVsDefault: true,
    },
  }),
}

const routes = {
  init: { type: 'session-start' },
  transition: {
    type: 'transition',
    args: [arg.state('STATE', stateSchema)],
  },
  'record-note': {
    type: 'transaction',
    args: [arg.string('NOTE')],
    handler: (workflow, note) => workflow.recordNote(note),
  },
}

function createPiApi() {
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const sentMessages = []
  const sentUserMessages = []
  return {
    handlers,
    tools,
    commands,
    sentMessages,
    sentUserMessages,
    api: {
      on: (event, handler) => handlers.set(event, handler),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (name, command) => commands.set(name, command),
      sendMessage: (message, options) => sentMessages.push({ message, options }),
      sendUserMessage: (content) => sentUserMessages.push(content),
    },
  }
}

function createContext(notifications, shutdowns) {
  const entries = [{
    type: 'message',
    id: 'assistant-message-1',
    parentId: null,
    timestamp: '2026-09-03T12:00:30.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'PLAN PLANNING continuing the workflow' }],
      stopReason: 'stop',
    },
  }]
  return {
    cwd: repositoryRoot,
    sessionManager: {
      getSessionId: () => 'pi-session-1',
      getSessionFile: () => sessionFile,
      getHeader: () => ({
        type: 'session',
        id: 'pi-session-1',
        timestamp: '2026-09-03T12:00:00.000Z',
        cwd: repositoryRoot,
      }),
      getBranch: () => entries,
      getEntries: () => entries,
      appendWorkflowMarker: (message) => entries.push({
        type: 'custom_message',
        id: 'workflow-guidance-1',
        parentId: 'assistant-message-1',
        timestamp: '2026-09-03T12:00:31.000Z',
        ...message,
      }),
    },
    ui: {
      notify: (message, type) => notifications.push({ message, type }),
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    shutdown: () => shutdowns.push('shutdown'),
  }
}

function readEvents() {
  const store = createStore(databasePath)
  try {
    return store.readEvents('pi-session-1')
  } finally {
    store.db.close()
  }
}

function countEvents(events, type) {
  return events.filter((event) => event.envelope.type === type).length
}

const extension = createPiWorkflowExtension({
  workflowDefinition,
  routes,
  bashForbidden: { commands: ['rm'] },
  isWriteAllowed: (_filePath, state) => state.currentStateMachineState === 'DEVELOPING',
  pluginRoot,
  databasePath,
  buildWorkflowDeps: () => ({}),
})

mkdirSync(join(pluginRoot, 'states'))
writeFileSync(join(pluginRoot, 'states', 'planning.md'), 'Plan before editing.')
writeFileSync(join(pluginRoot, 'states', 'developing.md'), 'Implement the approved plan.')
writeFileSync(sessionFile, '')

try {
  const runtime = createPiApi()
  const notifications = []
  const shutdowns = []
  const context = createContext(notifications, shutdowns)
  extension(runtime.api)

  await runtime.handlers.get('session_start')({
    type: 'session_start',
    reason: 'startup',
  }, context)
  assert.match(runtime.sentMessages[0].message.content, /Plan before editing/)
  assert.match(runtime.sentMessages[0].message.content, /call the `workflow` tool/)
  assert.deepEqual(runtime.sentMessages[0].options, { triggerTurn: false })
  context.sessionManager.appendWorkflowMarker(runtime.sentMessages[0].message)

  const blockedWrite = await runtime.handlers.get('tool_call')({
    type: 'tool_call',
    toolCallId: 'write-1',
    toolName: 'write',
    input: { path: 'src/app.ts', content: 'blocked' },
  }, context)
  assert.equal(blockedWrite.block, true)
  assert.match(blockedWrite.reason, /forbidden in state PLANNING/)

  const blockedBash = await runtime.handlers.get('tool_call')({
    type: 'tool_call',
    toolCallId: 'bash-1',
    toolName: 'bash',
    input: { command: 'rm -rf build' },
  }, context)
  assert.equal(blockedBash.block, true)
  assert.match(blockedBash.reason, /Bash command blocked in PLANNING/)

  const blockedQuestion = await runtime.handlers.get('tool_call')({
    type: 'tool_call',
    toolCallId: 'question-1',
    toolName: 'question',
    input: { question: 'Continue?' },
  }, context)
  assert.equal(blockedQuestion.block, true)
  assert.match(blockedQuestion.reason, /does not allow asking user questions/)

  await runtime.handlers.get('agent_settled')({ type: 'agent_settled' }, context)
  assert.equal(runtime.sentUserMessages[0], PI_IDLE_RECOVERY_MESSAGE)

  const treeResult = await runtime.handlers.get('session_before_tree')({
    type: 'session_before_tree',
  }, context)
  const forkResult = await runtime.handlers.get('session_before_fork')({
    type: 'session_before_fork',
  }, context)
  assert.deepEqual(treeResult, { cancel: true })
  assert.deepEqual(forkResult, { cancel: true })
  assert.equal(notifications.filter((item) => item.message === PI_SESSION_BRANCH_BLOCK_MESSAGE).length, 2)

  await runtime.commands.get('workflow').handler('transition DEVELOPING', context)
  assert.match(runtime.sentUserMessages[1], /Implement the approved plan/)

  const allowedWrite = await runtime.handlers.get('tool_call')({
    type: 'tool_call',
    toolCallId: 'write-2',
    toolName: 'write',
    input: { path: 'src/app.ts', content: 'allowed' },
  }, context)
  assert.equal(allowedWrite, undefined)

  const allowedQuestion = await runtime.handlers.get('tool_call')({
    type: 'tool_call',
    toolCallId: 'question-2',
    toolName: 'question',
    input: { question: 'Continue?' },
  }, context)
  assert.equal(allowedQuestion, undefined)

  await runtime.commands.get('workflow').handler("record-note 'from slash command'", context)
  const operationResult = await runtime.tools.get('workflow').execute(
    'workflow-1',
    { operation: 'record-note', args: ['from workflow tool'] },
    undefined,
    undefined,
    context,
  )
  assert.equal(operationResult.isError, false)
  assert.match(operationResult.content[0].text, /record-note/)

  const eventsBeforeResume = readEvents()
  assert.equal(countEvents(eventsBeforeResume, 'session-started'), 1)
  assert.equal(countEvents(eventsBeforeResume, 'transitioned'), 1)
  assert.equal(countEvents(eventsBeforeResume, 'note-recorded'), 2)
  assert.equal(countEvents(eventsBeforeResume, 'write-checked'), 2)
  assert.equal(countEvents(eventsBeforeResume, 'bash-checked'), 1)
  assert.equal(countEvents(eventsBeforeResume, 'stopping-checked'), 3)
  assert.equal(eventsBeforeResume.filter((event) => event.envelope.type === 'identity-verified').every((event) => event.payload.status === 'verified'), true)

  const resumedRuntime = createPiApi()
  extension(resumedRuntime.api)
  await resumedRuntime.handlers.get('session_start')({
    type: 'session_start',
    reason: 'resume',
    previousSessionFile: sessionFile,
  }, context)
  assert.equal(resumedRuntime.sentMessages.length, 0)
  const resumedState = await resumedRuntime.tools.get('workflow').execute(
    'workflow-2',
    { operation: 'get-state' },
    undefined,
    undefined,
    context,
  )
  assert.match(resumedState.content[0].text, /"currentStateMachineState": "DEVELOPING"/)
  await resumedRuntime.handlers.get('agent_settled')({ type: 'agent_settled' }, context)
  assert.equal(resumedRuntime.sentUserMessages.length, 0)
  assert.equal(countEvents(readEvents(), 'session-started'), 1)
  assert.equal(shutdowns.length, 0)
} finally {
  rmSync(pluginRoot, {
    recursive: true,
    force: true,
  })
}
