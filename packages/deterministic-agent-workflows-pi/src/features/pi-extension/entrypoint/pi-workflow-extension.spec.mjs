import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createExtensionRuntime,
  ExtensionRunner,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { arg } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { pass } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { z } from 'zod'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import {
  createPiWorkflowExtension,
  PI_IDLE_RECOVERY_MESSAGE,
} from './pi-workflow-extension.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../../..', import.meta.url))
const stateSchema = z.enum(['PLANNING', 'DEVELOPING'])
const testDirectories = []

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
      hasCommitsVsDefault: false,
    },
  }),
}

function createTestRoot() {
  const root = mkdtempSync(join(tmpdir(), 'daw-pi-extension-'))
  testDirectories.push(root)
  mkdirSync(join(root, 'states'))
  mkdirSync(join(root, 'sessions'))
  writeFileSync(join(root, 'states', 'planning.md'), 'Keep working.')
  writeFileSync(join(root, 'states', 'developing.md'), 'Keep developing.')
  return root
}

function createConfig(root, databasePath = join(root, 'workflow-events.db')) {
  return {
    workflowDefinition,
    routes: {
      init: { type: 'session-start' },
      transition: {
        type: 'transition',
        args: [arg.state('STATE', stateSchema)]
      },
      'record-note': {
        type: 'transaction',
        args: [arg.string('NOTE')],
        handler: (workflow, note) => workflow.recordNote(note),
      },
    },
    bashForbidden: { commands: ['rm'] },
    isWriteAllowed: () => false,
    pluginRoot: root,
    databasePath,
    buildWorkflowDeps: () => ({}),
  }
}

function registerFactory(factory, runtime) {
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const sourceInfo = {
    path: '<test>',
    scope: 'temporary',
    origin: 'explicit'
  }
  const extension = {
    path: '<test>',
    resolvedPath: '<test>',
    sourceInfo,
    handlers,
    tools,
    commands,
    flags: new Map(),
    shortcuts: new Map(),
    messageRenderers: new Map(),
  }
  factory({
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: (definition) => tools.set(definition.name, {
      definition,
      sourceInfo
    }),
    registerCommand: (name, command) => commands.set(name, {
      ...command,
      name,
      sourceInfo,
    }),
    sendMessage: (...args) => runtime.sendMessage(...args),
    sendUserMessage: (...args) => runtime.sendUserMessage(...args),
  })
  return extension
}

function createHarness(manager, config, options = {}) {
  const runtime = createExtensionRuntime()
  const extension = registerFactory(createPiWorkflowExtension(config), runtime)
  const runner = new ExtensionRunner([extension], runtime, options.cwd ?? repositoryRoot, manager, {})
  const sentMessages = []
  const sentUserMessages = []
  const notifications = []
  const state = { shutdowns: 0 }
  runner.setUIContext({
    notify: (message, type) => notifications.push({
      message,
      type
    }),
  }, 'print')
  runner.bindCore({
    sendMessage: (message, options) => {
      sentMessages.push({
        message,
        options
      })
      manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details)
    },
    sendUserMessage: (content) => sentUserMessages.push(content),
    appendEntry: (customType, data) => manager.appendCustomEntry(customType, data),
    setSessionName: (name) => manager.appendSessionInfo(name),
    getSessionName: () => manager.getSessionName(),
    setLabel: (entryId, label) => manager.appendLabelChange(entryId, label),
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => undefined,
    refreshTools: () => undefined,
    getCommands: () => [],
    setModel: async () => false,
    getThinkingLevel: () => 'off',
    setThinkingLevel: () => undefined,
  }, {
    getModel: () => undefined,
    getScopedModels: () => [],
    isIdle: () => options.isIdle ?? true,
    isProjectTrusted: () => true,
    getSignal: () => undefined,
    abort: () => undefined,
    hasPendingMessages: () => options.hasPendingMessages ?? false,
    shutdown: () => { state.shutdowns += 1 },
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => '',
  })
  return {
    runner,
    sentMessages,
    sentUserMessages,
    notifications,
    state,
    workflowTool: extension.tools.get(config.toolName ?? 'workflow').definition,
    workflowCommand: extension.commands.get(config.commandName ?? 'workflow'),
  }
}

function appendWorkflowMarker(manager) {
  return manager.appendCustomMessageEntry(
    'deterministic-agent-workflow',
    'Workflow guidance.',
    true,
  )
}

function appendAssistant(manager, stopReason) {
  return manager.appendMessage({
    role: 'assistant',
    content: [{
      type: 'text',
      text: 'PLAN PLANNING continuing'
    }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason,
    timestamp: Date.now(),
  })
}

function workflowStarted(databasePath, sessionId) {
  const store = createStore(databasePath)
  try {
    return store.hasSessionStarted(sessionId)
  } finally {
    store.db.close()
  }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) rmSync(directory, {
    recursive: true,
    force: true,
  })
})

describe('createPiWorkflowExtension', () => {
  it('persists initial guidance once and retains it across a real SessionManager resume', async () => {
    const root = createTestRoot()
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const initial = createHarness(manager, createConfig(root))
    await initial.runner.emit({
      type: 'session_start',
      reason: 'startup'
    })
    appendAssistant(manager, 'stop')
    const sessionFile = manager.getSessionFile()
    const resumedManager = SessionManager.open(sessionFile)
    const resumed = createHarness(resumedManager, createConfig(root))
    await resumed.runner.emit({
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: sessionFile
    })
    const readyInput = await resumed.runner.emitInput('Continue.', undefined, 'interactive')

    expect(initial.sentMessages[0].options).toStrictEqual({ triggerTurn: false })
    expect(resumedManager.getEntries().filter((entry) => entry.type === 'custom_message')).toHaveLength(1)
    expect(resumed.sentMessages).toHaveLength(0)
    expect(readyInput).toStrictEqual({ action: 'continue' })
    expect(initial.state.shutdowns + resumed.state.shutdowns).toBe(0)
  })

  it('survives Pi lifecycle exception swallowing and blocks tools after database initialization failure', async () => {
    const root = createTestRoot()
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root, root))
    const errors = []
    harness.runner.onError((error) => errors.push(error))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup'
    })
    const blockedInput = await harness.runner.emitInput('Continue despite failure.', undefined, 'interactive')
    const blocked = await harness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'write-1',
      toolName: 'write',
      input: {
        path: 'src/app.ts',
        content: 'unsafe'
      },
    })

    expect(harness.state.shutdowns).toBe(1)
    expect(blockedInput).toStrictEqual({ action: 'handled' })
    expect(harness.notifications.at(-1)?.type).toBe('error')
    expect(errors).toHaveLength(0)
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('Pi workflow initialization failed')
  })

  it('rejects a real in-memory SessionManager and blocks every later tool call', async () => {
    const root = createTestRoot()
    const manager = SessionManager.inMemory(repositoryRoot)
    const harness = createHarness(manager, createConfig(root))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup'
    })
    const blockedInput = await harness.runner.emitInput('Continue without a session.', undefined, 'interactive')
    const blocked = await harness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'bash-1',
      toolName: 'bash',
      input: { command: 'pwd' },
    })

    expect(harness.state.shutdowns).toBe(1)
    expect(blockedInput).toStrictEqual({ action: 'handled' })
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('Ephemeral Pi sessions are unsupported')
  })

  it('blocks startup forks whose parent UUID has an active workflow', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const parent = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const parentHarness = createHarness(parent, createConfig(root, databasePath))
    await parentHarness.runner.emit({
      type: 'session_start',
      reason: 'startup'
    })
    appendAssistant(parent, 'stop')
    const child = SessionManager.forkFrom(parent.getSessionFile(), repositoryRoot, join(root, 'sessions'))
    const childHarness = createHarness(child, createConfig(root, databasePath))
    await childHarness.runner.emit({
      type: 'session_start',
      reason: 'startup'
    })
    const blocked = await childHarness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'write-2',
      toolName: 'write',
      input: {
        path: 'src/app.ts',
        content: 'unsafe'
      },
    })

    expect(childHarness.state.shutdowns).toBe(1)
    expect(workflowStarted(databasePath, child.getSessionId())).toBe(false)
    expect(blocked?.reason).toContain(`Cannot fork Pi session ${parent.getSessionId()}`)
  })

  it('fails closed when an active transcript marker has lost its SQLite workflow state', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    appendWorkflowMarker(manager)
    const harness = createHarness(manager, createConfig(root, databasePath))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: manager.getSessionFile(),
    })
    const blockedInput = await harness.runner.emitInput('Continue from lost state.', undefined, 'rpc')

    expect(harness.state.shutdowns).toBe(1)
    expect(harness.sentMessages).toHaveLength(0)
    expect(workflowStarted(databasePath, manager.getSessionId())).toBe(false)
    expect(harness.notifications[0].message).toContain('transcript and SQLite workflow state disagree')
    expect(blockedInput).toStrictEqual({ action: 'handled' })
  })

  it('fails closed when the active branch no longer contains the workflow marker', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const preWorkflowEntryId = appendAssistant(manager, 'stop')
    const initial = createHarness(manager, createConfig(root, databasePath))
    await initial.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    manager.branch(preWorkflowEntryId)
    const resumed = createHarness(manager, createConfig(root, databasePath))
    await resumed.runner.emit({
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: manager.getSessionFile(),
    })

    expect(resumed.state.shutdowns).toBe(1)
    expect(resumed.notifications[0].message).toContain('active Pi branch does not contain')
    expect(await resumed.runner.emitInput('Continue unsafe branch.', undefined, 'interactive')).toStrictEqual({ action: 'handled' })
  })

  it('starts safely when adding the extension to an old transcript without a workflow marker', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    appendAssistant(manager, 'stop')
    const harness = createHarness(manager, createConfig(root, databasePath))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: manager.getSessionFile(),
    })

    expect(harness.state.shutdowns).toBe(0)
    expect(harness.sentMessages).toHaveLength(1)
    expect(workflowStarted(databasePath, manager.getSessionId())).toBe(true)
    expect(await harness.runner.emitInput('Start using workflows.', undefined, 'interactive')).toStrictEqual({ action: 'continue' })
  })

  it('blocks startup forks when only the parent transcript marker remains', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const parent = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    appendWorkflowMarker(parent)
    appendAssistant(parent, 'stop')
    const child = SessionManager.forkFrom(parent.getSessionFile(), repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(child, createConfig(root, databasePath))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })

    expect(harness.state.shutdowns).toBe(1)
    expect(workflowStarted(databasePath, child.getSessionId())).toBe(false)
    expect(harness.notifications[0].message).toContain(`Cannot fork Pi session ${parent.getSessionId()}`)
    expect(await harness.runner.emitInput('Continue unsafe fork.', undefined, 'interactive')).toStrictEqual({ action: 'handled' })
  })

  it('resumes an established child without revalidating its deleted parent', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const parent = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    appendAssistant(parent, 'stop')
    const parentFile = parent.getSessionFile()
    const child = SessionManager.forkFrom(parentFile, repositoryRoot, join(root, 'sessions'))
    const initial = createHarness(child, createConfig(root, databasePath))
    await initial.runner.emit({
      type: 'session_start',
      reason: 'fork',
      previousSessionFile: parentFile,
    })
    appendAssistant(child, 'stop')
    const childFile = child.getSessionFile()
    rmSync(parentFile)

    const resumedManager = SessionManager.open(childFile)
    const resumed = createHarness(resumedManager, createConfig(root, databasePath))
    await resumed.runner.emit({
      type: 'session_start',
      reason: 'resume',
      previousSessionFile: childFile,
    })

    expect(initial.state.shutdowns).toBe(0)
    expect(resumed.state.shutdowns).toBe(0)
    expect(workflowStarted(databasePath, child.getSessionId())).toBe(true)
  })

  it('recovers only distinct normal stop settlements', async () => {
    const root = createTestRoot()
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup'
    })
    for (const stopReason of ['error', 'aborted', 'length', 'toolUse']) {
      appendAssistant(manager, stopReason)
      await harness.runner.emit({ type: 'agent_settled' })
    }
    expect(harness.sentUserMessages).toHaveLength(0)
    appendAssistant(manager, 'stop')
    await harness.runner.emit({ type: 'agent_settled' })
    expect(harness.sentUserMessages).toStrictEqual([PI_IDLE_RECOVERY_MESSAGE])
    await harness.runner.emit({ type: 'agent_settled' })
    expect(harness.sentUserMessages).toHaveLength(1)
    appendAssistant(manager, 'stop')
    await harness.runner.emit({ type: 'agent_settled' })
    expect(harness.sentUserMessages).toHaveLength(2)
  })

  it('executes registered tool and command routes after initialization', async () => {
    const root = createTestRoot()
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })

    const toolResult = await harness.workflowTool.execute(
      'workflow-1',
      { operation: 'unknown' },
      undefined,
      undefined,
      harness.runner.createContext(),
    )
    await harness.workflowCommand.handler('init', harness.runner.createCommandContext())
    await harness.workflowCommand.handler('transition DEVELOPING', harness.runner.createCommandContext())
    await harness.workflowCommand.handler('record-note "route completed"', harness.runner.createCommandContext())
    await harness.workflowCommand.handler('get-reflection-process', harness.runner.createCommandContext())
    await harness.workflowCommand.handler('unknown', harness.runner.createCommandContext())
    await harness.workflowCommand.handler('"unfinished', harness.runner.createCommandContext())

    expect(toolResult.isError).toBe(true)
    expect(toolResult.details.exitCode).toBe(1)
    expect(harness.sentUserMessages.length).toBeGreaterThan(0)
  })

  it('fails closed when command routes run before initialization or lose database access', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root, databasePath))
    const pending = await harness.workflowTool.execute(
      'workflow-pending',
      {
        operation: 'unknown',
        args: ['argument']
      },
      undefined,
      undefined,
      harness.runner.createContext(),
    )
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    rmSync(databasePath)
    mkdirSync(databasePath)
    const unsafe = await harness.workflowTool.execute(
      'workflow-unsafe',
      { operation: 'unknown' },
      undefined,
      undefined,
      harness.runner.createContext(),
    )

    expect(pending.isError).toBe(true)
    expect(pending.content[0].text).toContain('has not completed safely')
    expect(unsafe.content[0].text).toContain('Workflow operation could not establish safe state')
    expect(harness.state.shutdowns).toBe(1)
  })

  it('fails closed if a session UUID disappears during route, tool, or settlement handling', async () => {
    const root = createTestRoot()

    const routeManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const routeHarness = createHarness(routeManager, createConfig(root))
    await routeHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    const routeId = routeManager.getSessionId()
    let routeReads = 0
    routeManager.getSessionId = () => {
      routeReads += 1
      if (routeReads === 2) throw new Error('route UUID unavailable')
      return routeId
    }
    const routeResult = await routeHarness.workflowTool.execute(
      'workflow-missing-id',
      { operation: 'unknown' },
      undefined,
      undefined,
      routeHarness.runner.createContext(),
    )

    const toolManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const toolHarness = createHarness(toolManager, createConfig(root))
    await toolHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    const toolId = toolManager.getSessionId()
    let toolReads = 0
    toolManager.getSessionId = () => {
      toolReads += 1
      if (toolReads === 2) throw new Error('tool UUID unavailable')
      return toolId
    }
    const toolResult = await toolHarness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'read-missing-id',
      toolName: 'read',
      input: { path: 'README.md' },
    })

    const settlementManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const settlementHarness = createHarness(settlementManager, createConfig(root))
    await settlementHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    const settlementId = settlementManager.getSessionId()
    let settlementReads = 0
    settlementManager.getSessionId = () => {
      settlementReads += 1
      if (settlementReads === 2) throw new Error('settlement UUID unavailable')
      return settlementId
    }
    await settlementHarness.runner.emit({ type: 'agent_settled' })

    expect(routeResult.content[0].text).toContain('route UUID unavailable')
    expect(toolResult?.reason).toContain('tool UUID unavailable')
    expect(settlementHarness.sentUserMessages).toHaveLength(0)
  })

  it('skips settlement handling before initialization and without assistant output', async () => {
    const root = createTestRoot()
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root))
    await harness.runner.emit({ type: 'agent_settled' })
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    await harness.runner.emit({ type: 'agent_settled' })

    expect(harness.sentUserMessages).toHaveLength(0)
  })

  it('resolves configured, environment, and default event database paths', () => {
    const root = createTestRoot()
    const configured = createConfig(root)
    const configuredFactory = createPiWorkflowExtension(configured)

    const fromEnvironment = createConfig(root)
    delete fromEnvironment.databasePath
    process.env.WORKFLOW_EVENTS_DB = join(root, 'environment.db')
    const environmentFactory = createPiWorkflowExtension(fromEnvironment)

    const fromDefault = createConfig(root, '')
    process.env.WORKFLOW_EVENTS_DB = ''
    const defaultFactory = createPiWorkflowExtension(fromDefault)
    delete process.env.WORKFLOW_EVENTS_DB

    expect([configuredFactory, environmentFactory, defaultFactory].every((factory) => typeof factory === 'function')).toBe(true)
  })

  it('blocks unsafe tools and allows safe tools after initialization', async () => {
    const root = createTestRoot()
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })

    const blocked = await harness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'write-3',
      toolName: 'write',
      input: { path: 'src/app.ts' },
    })
    const allowed = await harness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'bash-2',
      toolName: 'bash',
      input: { command: 'pwd' },
    })
    const blockedPowerShell = await harness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'powershell-1',
      toolName: 'powershell',
      input: { command: 'rm build' },
    })

    expect(blocked?.block).toBe(true)
    expect(allowed).toBeUndefined()
    expect(blockedPowerShell?.block).toBe(true)
  })

  it('fails closed when a tool safety check loses database access', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root, databasePath))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    rmSync(databasePath)
    mkdirSync(databasePath)

    const blocked = await harness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'question-2',
      toolName: 'question',
      input: { question: 'Proceed?' },
    })

    expect(blocked?.reason).toContain('Tool safety could not be established')
    expect(harness.state.shutdowns).toBe(1)
  })

  it('fails closed for invalid session UUID access and mismatched headers', async () => {
    const root = createTestRoot()
    const emptyIdManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    emptyIdManager.getSessionId = () => ''
    const emptyIdHarness = createHarness(emptyIdManager, createConfig(root))
    await emptyIdHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })

    const throwingManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    throwingManager.getSessionId = () => { throw new Error('UUID unavailable') }
    const throwingHarness = createHarness(throwingManager, createConfig(root))
    const blockedTree = await throwingHarness.runner.emit({ type: 'session_before_tree' })
    const blockedTool = await throwingHarness.runner.emitToolCall({
      type: 'tool_call',
      toolCallId: 'read-1',
      toolName: 'read',
      input: { path: 'README.md' },
    })

    const mismatchedManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    mismatchedManager.getHeader = () => ({
      type: 'session',
      id: 'different-session',
      timestamp: '2026-09-03T12:00:00.000Z',
      cwd: repositoryRoot,
    })
    const mismatchedHarness = createHarness(mismatchedManager, createConfig(root))
    await mismatchedHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    const emptyIdInput = await emptyIdHarness.runner.emitInput('Continue.', undefined, 'interactive')
    const mismatchedInput = await mismatchedHarness.runner.emitInput('Continue.', undefined, 'interactive')

    expect(emptyIdHarness.state.shutdowns).toBe(1)
    expect(emptyIdInput).toStrictEqual({ action: 'handled' })
    expect(blockedTree).toStrictEqual({ cancel: true })
    expect(blockedTool?.reason).toContain('UUID is unavailable')
    expect(throwingHarness.state.shutdowns).toBe(1)
    expect(mismatchedHarness.state.shutdowns).toBe(1)
    expect(mismatchedInput).toStrictEqual({ action: 'handled' })
  })

  it('rejects unverifiable forks and permits forks from inactive parents', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const missingParent = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const missingParentHarness = createHarness(missingParent, createConfig(root, databasePath))
    await missingParentHarness.runner.emit({
      type: 'session_start',
      reason: 'fork',
    })

    const parent = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    appendAssistant(parent, 'stop')
    const child = SessionManager.forkFrom(parent.getSessionFile(), repositoryRoot, join(root, 'sessions'))
    const childHarness = createHarness(child, createConfig(root, databasePath))
    await childHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })

    expect(missingParentHarness.state.shutdowns).toBe(1)
    expect(childHarness.state.shutdowns).toBe(0)
    expect(workflowStarted(databasePath, child.getSessionId())).toBe(true)
  })

  it('blocks tree navigation for active and not-yet-initialized sessions', async () => {
    const root = createTestRoot()
    const pendingManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const pendingHarness = createHarness(pendingManager, createConfig(root))
    const pendingResult = await pendingHarness.runner.emit({ type: 'session_before_tree' })
    const pendingInput = await pendingHarness.runner.emitInput('Premature input.', undefined, 'extension')

    const activeManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const activeHarness = createHarness(activeManager, createConfig(root))
    await activeHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    const activeResult = await activeHarness.runner.emit({ type: 'session_before_fork' })

    expect(pendingResult).toStrictEqual({ cancel: true })
    expect(pendingInput).toStrictEqual({ action: 'handled' })
    expect(pendingHarness.state.shutdowns).toBe(1)
    expect(activeResult).toStrictEqual({ cancel: true })
  })

  it('keeps tree navigation blocked after persisted workflow state is deleted', async () => {
    const root = createTestRoot()
    const databasePath = join(root, 'workflow-events.db')
    const manager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root, databasePath))
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    rmSync(databasePath)

    expect(await harness.runner.emit({ type: 'session_before_tree' })).toStrictEqual({ cancel: true })
    expect(harness.state.shutdowns).toBe(0)
  })

  it('keeps tree navigation blocked and fails stopping safety when database access is lost', async () => {
    const root = createTestRoot()
    const treeDatabase = join(root, 'tree-events.db')
    const treeManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const treeHarness = createHarness(treeManager, createConfig(root, treeDatabase))
    await treeHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    rmSync(treeDatabase)
    mkdirSync(treeDatabase)
    const blockedTree = await treeHarness.runner.emit({ type: 'session_before_tree' })

    const stopDatabase = join(root, 'stop-events.db')
    const stopManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const stopHarness = createHarness(stopManager, createConfig(root, stopDatabase))
    await stopHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    appendAssistant(stopManager, 'stop')
    rmSync(stopDatabase)
    mkdirSync(stopDatabase)
    await stopHarness.runner.emit({ type: 'agent_settled' })

    expect(blockedTree).toStrictEqual({ cancel: true })
    expect(treeHarness.state.shutdowns).toBe(0)
    expect(stopHarness.state.shutdowns).toBe(1)
  })

  it('does not recover while Pi is busy or has pending messages', async () => {
    const root = createTestRoot()
    const busyManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const busyHarness = createHarness(busyManager, createConfig(root), { isIdle: false })
    await busyHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    appendAssistant(busyManager, 'stop')
    await busyHarness.runner.emit({ type: 'agent_settled' })

    const pendingManager = SessionManager.create(repositoryRoot, join(root, 'sessions'))
    const pendingHarness = createHarness(pendingManager, createConfig(root), { hasPendingMessages: true })
    await pendingHarness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })
    appendAssistant(pendingManager, 'stop')
    await pendingHarness.runner.emit({ type: 'agent_settled' })

    expect(busyHarness.sentUserMessages).toHaveLength(0)
    expect(pendingHarness.sentUserMessages).toHaveLength(0)
  })

  it('rejects sessions outside a Git repository', async () => {
    const root = createTestRoot()
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, '.git', 'objects'))
    mkdirSync(join(root, '.git', 'refs'))
    mkdirSync(join(root, '.git', 'refs', 'heads'))
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(root, '.git', 'config'), [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tbare = false',
      '[remote "origin"]',
      '\turl = https://example.com/not-github.git',
      '',
    ].join('\n'))
    const manager = SessionManager.create(root, join(root, 'sessions'))
    const harness = createHarness(manager, createConfig(root), { cwd: root })
    await harness.runner.emit({
      type: 'session_start',
      reason: 'startup',
    })

    expect(harness.state.shutdowns).toBe(1)
  })
})
