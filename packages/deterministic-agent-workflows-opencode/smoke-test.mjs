import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { arg } from '../deterministic-agent-workflows-cli/dist/index.js'
import { pass } from '../deterministic-agent-workflows-engine/dist/index.js'
import { createOpenCodeWorkflowPlugin } from './dist/index.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function createWorkflow(initialState = { currentStateMachineState: 'PLANNING', transcriptPath: '' }) {
  let state = initialState
  const pending = []

  return {
    getState: () => state,
    appendEvent: (event) => {
      pending.push(event)
      if (event.type === 'session-started' && typeof event.transcriptPath === 'string') {
        state = { ...state, transcriptPath: event.transcriptPath }
      }
      if (event.type === 'transitioned' && typeof event.to === 'string') {
        state = { ...state, currentStateMachineState: event.to }
      }
    },
    getPendingEvents: () => pending.splice(0),
    startSession: (transcriptPath, repository) => {
      state = { ...state, transcriptPath }
      pending.push({ type: 'session-started', at: new Date().toISOString(), transcriptPath, repository })
    },
    getTranscriptPath: () => state.transcriptPath,
    registerAgent: () => pass(),
    handleTeammateIdle: () => pass(),
    executeRecording: () => pass(),
  }
}

const workflowDefinition = {
  fold: (state, event) => {
    if (event.type === 'session-started' && typeof event.transcriptPath === 'string') {
      return { ...state, transcriptPath: event.transcriptPath }
    }
    if (event.type === 'transitioned' && typeof event.to === 'string') {
      return { ...state, currentStateMachineState: event.to }
    }
    return state
  },
  buildWorkflow: (state) => createWorkflow(state),
  stateSchema: z.enum(['PLANNING', 'DEVELOPING']),
  initialState: () => ({ currentStateMachineState: 'PLANNING', transcriptPath: '' }),
  getRegistry: () => ({
    PLANNING: {
      emoji: '🧠',
      agentInstructions: 'states/planning.md',
      canTransitionTo: ['DEVELOPING'],
      allowedWorkflowOperations: [],
      forbidden: { write: true },
    },
    DEVELOPING: {
      emoji: '🛠️',
      agentInstructions: 'states/developing.md',
      canTransitionTo: ['PLANNING'],
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
      hasCommitsVsDefault: false,
    },
  }),
}

const routes = {
  init: { type: 'session-start' },
  transition: { type: 'transition', args: [arg.state('STATE', z.enum(['PLANNING', 'DEVELOPING']))] },
}

const pluginRoot = mkdtempSync(join(tmpdir(), 'daw-opencode-smoke-'))
mkdirSync(join(pluginRoot, 'states'))
writeFileSync(join(pluginRoot, 'states', 'planning.md'), 'planning instructions')
writeFileSync(join(pluginRoot, 'states', 'developing.md'), 'developing instructions')
process.env['WORKFLOW_EVENTS_DB'] = join(pluginRoot, 'workflow-events.db')

try {
  const plugin = createOpenCodeWorkflowPlugin({
    workflowDefinition,
    routes,
    bashForbidden: { commands: ['rm'] },
    isWriteAllowed: (_filePath, state) => state.currentStateMachineState === 'DEVELOPING',
    pluginRoot,
    commandDirectories: [],
    commandPrefix: 'demo:',
    buildWorkflowDeps: () => ({}),
  })

  const hooks = await plugin()
  const ctx = {
    sessionID: 'session-1',
    messageID: 'm1',
    agent: 'general',
    directory: repoRoot,
    worktree: repoRoot,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  const initOutput = await hooks.tool.workflow.execute({ operation: 'init' }, ctx)
  const beforeHook = hooks['tool.execute.before']

  let blocked = false
  try {
    await beforeHook({ tool: 'Write', sessionID: 'session-1', callID: 'c1' }, { args: { file_path: 'src/a.ts' } })
  } catch {
    blocked = true
  }

  await hooks.tool.workflow.execute({ operation: 'transition', args: ['DEVELOPING'] }, ctx)

  let allowed = true
  try {
    await beforeHook({ tool: 'Write', sessionID: 'session-1', callID: 'c2' }, { args: { file_path: 'src/a.ts' } })
  } catch {
    allowed = false
  }

  if (!initOutput.includes('planning instructions') || !blocked || !allowed) {
    throw new Error(`Smoke test failed: ${JSON.stringify({ blocked, allowed, initOutput })}`)
  }
} finally {
  rmSync(pluginRoot, { recursive: true, force: true })
}
