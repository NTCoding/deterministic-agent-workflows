import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { arg } from '../deterministic-agent-workflows-cli/dist/index.js'
import { pass } from '../deterministic-agent-workflows-engine/dist/index.js'
import { openSqliteDatabase } from '../deterministic-agent-workflows-event-store/dist/index.js'
import { createOpenCodeWorkflowPlugin } from './dist/index.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function seedOpencodeTranscript(dbPath, sessionId, assistantText) {
  const db = openSqliteDatabase(dbPath)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)
    const insertMessage = db.prepare(
      'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
    )
    const insertPart = db.prepare(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const createdAt = Date.now()
    const messageId = 'assistant-message-1'

    insertMessage.run(
      messageId,
      sessionId,
      createdAt,
      createdAt,
      JSON.stringify({ role: 'assistant' }),
    )
    insertPart.run(
      'assistant-part-1',
      messageId,
      sessionId,
      createdAt,
      createdAt,
      JSON.stringify({
        type: 'text',
        text: assistantText 
      }),
    )
  } finally {
    db.close()
  }
}

function readLatestIdentityStatus(dbPath, sessionId) {
  const db = openSqliteDatabase(dbPath, { readonly: true })
  try {
    const row = db.prepare(
      "SELECT payload FROM events WHERE session_id = ? AND type = 'identity-verified' ORDER BY seq DESC LIMIT 1",
    ).get(sessionId)
    if (typeof row !== 'object' || row === null || typeof row.payload !== 'string') {
      throw new Error(`Missing identity-verified event for ${sessionId}`)
    }
    const payload = JSON.parse(row.payload)
    if (typeof payload !== 'object' || payload === null || typeof payload.status !== 'string') {
      throw new Error(`Invalid identity-verified payload for ${sessionId}: ${row.payload}`)
    }
    return payload.status
  } finally {
    db.close()
  }
}

function createWorkflow(initialState = {
  currentStateMachineState: 'PLANNING',
  transcriptPath: '' 
}) {
  let state = initialState
  const pending = []

  return {
    getState: () => state,
    appendEvent: (event) => {
      pending.push(event)
      if (event.type === 'session-started' && typeof event.transcriptPath === 'string') {
        state = {
          ...state,
          transcriptPath: event.transcriptPath 
        }
      }
      if (event.type === 'transitioned' && typeof event.to === 'string') {
        state = {
          ...state,
          currentStateMachineState: event.to 
        }
      }
    },
    getPendingEvents: () => pending.splice(0),
    startSession: (transcriptPath, repository) => {
      state = {
        ...state,
        transcriptPath 
      }
      pending.push({
        type: 'session-started',
        at: new Date().toISOString(),
        transcriptPath,
        repository 
      })
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
      return {
        ...state,
        transcriptPath: event.transcriptPath 
      }
    }
    if (event.type === 'transitioned' && typeof event.to === 'string') {
      return {
        ...state,
        currentStateMachineState: event.to 
      }
    }
    return state
  },
  buildWorkflow: (state) => createWorkflow(state),
  stateSchema: z.enum(['PLANNING', 'DEVELOPING']),
  initialState: () => ({
    currentStateMachineState: 'PLANNING',
    transcriptPath: '' 
  }),
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
      allowIdle: true,
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
  transition: {
    type: 'transition',
    args: [arg.state('STATE', z.enum(['PLANNING', 'DEVELOPING']))] 
  },
}

const pluginRoot = mkdtempSync(join(tmpdir(), 'daw-opencode-smoke-'))
mkdirSync(join(pluginRoot, 'states'))
writeFileSync(join(pluginRoot, 'states', 'planning.md'), 'planning instructions')
writeFileSync(join(pluginRoot, 'states', 'developing.md'), 'developing instructions')
const workflowEventsPath = join(pluginRoot, 'workflow-events.db')
const opencodeDatabasePath = join(pluginRoot, 'opencode.db')
process.env['WORKFLOW_EVENTS_DB'] = workflowEventsPath
seedOpencodeTranscript(opencodeDatabasePath, 'session-1', '🧠 PLANNING proving OpenCode transcript parts are read')

try {
  const promptedTexts = []
  const plugin = createOpenCodeWorkflowPlugin({
    workflowDefinition,
    routes,
    bashForbidden: { commands: ['rm'] },
    isWriteAllowed: (_filePath, state) => state.currentStateMachineState === 'DEVELOPING',
    pluginRoot,
    databasePath: opencodeDatabasePath,
    commandDirectories: [],
    commandPrefix: 'demo:',
    buildWorkflowDeps: () => ({}),
  })

  const hooks = await plugin({
    client: {
      session: {
        promptAsync: async ({ body }) => {
          promptedTexts.push(body.parts[0].text)
        },
      },
    },
  })
  const ctx = {
    sessionID: 'session-1',
    messageID: 'm1',
    agent: 'general',
    directory: repoRoot,
    worktree: repoRoot,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  }

  const initOutput = await hooks.tool.workflow.execute({ operation: 'init' }, ctx)
  const beforeHook = hooks['tool.execute.before']
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-1' },
    },
  })

  let blocked = false
  try {
    await beforeHook({
      tool: 'Write',
      sessionID: 'session-1',
      callID: 'c1' 
    }, { args: { file_path: 'src/a.ts' } })
  } catch {
    blocked = true
  }

  await hooks.tool.workflow.execute({
    operation: 'transition',
    args: ['DEVELOPING'] 
  }, ctx)
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-1' },
    },
  })
  const identityStatus = readLatestIdentityStatus(workflowEventsPath, 'session-1')

  let allowed = true
  try {
    await beforeHook({
      tool: 'Write',
      sessionID: 'session-1',
      callID: 'c2' 
    }, { args: { file_path: 'src/a.ts' } })
  } catch {
    allowed = false
  }

  if (!initOutput.includes('planning instructions') || !blocked || !allowed || identityStatus !== 'verified' || promptedTexts.length !== 1) {
    throw new Error(`Smoke test failed: ${JSON.stringify({
      blocked,
      allowed,
      identityStatus,
      promptedTexts,
      initOutput 
    })}`)
  }
} finally {
  rmSync(pluginRoot, {
    recursive: true,
    force: true 
  })
}
