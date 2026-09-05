import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const captured = vi.hoisted(() => ({engineDeps: undefined,}))

vi.mock('@nt-ai-lab/deterministic-agent-workflow-engine', () => ({
  WorkflowEngine: class {
    constructor(_definition, engineDeps) {
      captured.engineDeps = engineDeps
    }

    startSession() {
      return {
        type: 'success',
        output: '',
      }
    }

    hasSessionStarted() {
      return false
    }
  },
}))

vi.mock('@nt-ai-lab/deterministic-agent-workflow-cli', () => ({
  createPreToolUseHandler: () => () => ({
    type: 'success',
    output: ''
  }),
  createWorkflowRunner: () => () => ({
    output: '',
    exitCode: 0
  }),
  formatStopPreventionMessage: () => '[Automatic Workflow Hook Response]',
  getRepositoryName: () => 'NTCoding/deterministic-agent-workflows',
}))

vi.mock('@nt-ai-lab/deterministic-agent-workflow-event-store', () => ({
  createStore: () => ({
    hasSessionStarted: () => false,
    db: { close: () => undefined },
  }),
}))

import { createPiWorkflowExtension } from './pi-workflow-extension.ts'

describe('Pi workflow engine dependencies', () => {
  it('provides operational engine and platform dependency callbacks', async () => {
    const handlers = new Map()
    const commands = new Map()
    const platformValues = []
    const factory = createPiWorkflowExtension({
      workflowDefinition: {},
      routes: {},
      unknownCommandMessage: 'Run a supported workflow operation.',
      bashForbidden: { commands: [] },
      isWriteAllowed: () => true,
      pluginRoot: '/plugin',
      databasePath: '/events.db',
      buildWorkflowDeps: (platform) => {
        platformValues.push(
          platform.getPluginRoot(),
          platform.now(),
          platform.getSessionId(),
        )
        return {}
      },
    })
    factory({
      on: (name, handler) => handlers.set(name, handler),
      registerTool: () => undefined,
      registerCommand: (name, command) => commands.set(name, command),
      sendMessage: () => undefined,
      sendUserMessage: () => undefined,
    })
    const branch = []
    const context = {
      cwd: '/repo',
      sessionManager: {
        getSessionId: () => 'session-id',
        getSessionFile: () => '/session.jsonl',
        getHeader: () => ({ id: 'session-id' }),
        getBranch: () => branch,
        getEntries: () => branch,
      },
      ui: { notify: () => undefined },
      shutdown: () => undefined,
    }
    handlers.get('session_start')({
      type: 'session_start',
      reason: 'startup',
    }, context)
    await commands.get('workflow').handler('init', context)

    expect(captured.engineDeps.getPluginRoot()).toBe('/plugin')
    expect(captured.engineDeps.getEnvFilePath()).toBe('/plugin/.pi/unused.env')
    expect(captured.engineDeps.getRepositoryName()).toBe('NTCoding/deterministic-agent-workflows')
    expect(captured.engineDeps.appendToFile('/unused', 'unused')).toBeUndefined()
    expect(captured.engineDeps.readFile).toBeTypeOf('function')
    expect(captured.engineDeps.transcriptReader.readMessages()).toStrictEqual([])
    expect(captured.engineDeps.sessionContext.getMainSessionId()).toBe('session-id')
    expect(platformValues).toHaveLength(6)
  })
})
