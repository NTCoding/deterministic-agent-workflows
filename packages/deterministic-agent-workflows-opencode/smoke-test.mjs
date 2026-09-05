import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { arg } from '../deterministic-agent-workflows-cli/dist/index.js'
import {
  pass,
  reduceWorkflowStateFromStoredEvents,
} from '../deterministic-agent-workflows-engine/dist/index.js'
import {
  createStore,
  openSqliteDatabase,
} from '../deterministic-agent-workflows-event-store/dist/index.js'
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

function readReviewSummary(dbPath, sessionId) {
  const db = openSqliteDatabase(dbPath, { readonly: true })
  try {
    const reviewCountRow = db.prepare(
      'SELECT COUNT(1) AS count FROM reviews WHERE session_id = ?',
    ).get(sessionId)
    const eventCountRow = db.prepare(
      "SELECT COUNT(1) AS count FROM events WHERE session_id = ? AND type = 'review-recorded'",
    ).get(sessionId)
    const reviewRow = db.prepare(
      'SELECT review_type, verdict FROM reviews WHERE session_id = ? ORDER BY id DESC LIMIT 1',
    ).get(sessionId)
    const eventRow = db.prepare(
      "SELECT payload FROM events WHERE session_id = ? AND type = 'review-recorded' ORDER BY seq DESC LIMIT 1",
    ).get(sessionId)
    return {
      reviewCount: Number(reviewCountRow.count),
      eventCount: Number(eventCountRow.count),
      reviewRow,
      eventRow,
    }
  } finally {
    db.close()
  }
}

function readWorkflowState(dbPath, sessionId) {
  const store = createStore(dbPath)
  try {
    return reduceWorkflowStateFromStoredEvents(workflowDefinition, store.readEvents(sessionId))
  } finally {
    store.db.close()
  }
}

function readWriteCheckCount(dbPath, sessionId, tool) {
  const db = openSqliteDatabase(dbPath, { readonly: true })
  try {
    const row = db.prepare(
      "SELECT COUNT(1) AS count FROM events WHERE session_id = ? AND type = 'write-checked' AND json_extract(payload, '$.tool') = ?",
    ).get(sessionId, tool)
    return Number(row.count)
  } finally {
    db.close()
  }
}

async function captureWorkflowError(workflowCall) {
  try {
    await workflowCall()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function createWorkflow(initialState = {
  currentStateMachineState: 'PLANNING',
  transcriptPath: '',
  issueNumbers: [],
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
      if (event.type === 'issue-recorded' && typeof event.issueNumber === 'number') {
        state = {
          ...state,
          issueNumbers: [...state.issueNumbers, event.issueNumber],
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
    recordIssue: (issueNumber) => {
      pending.push({
        type: 'issue-recorded',
        at: new Date().toISOString(),
        issueNumber,
      })
      state = {
        ...state,
        issueNumbers: [...state.issueNumbers, issueNumber],
      }
      return pass()
    },
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
    if (event.type === 'issue-recorded' && typeof event.issueNumber === 'number') {
      return {
        ...state,
        issueNumbers: [...state.issueNumbers, event.issueNumber],
      }
    }
    return state
  },
  buildWorkflow: (state) => createWorkflow(state),
  stateSchema: z.enum(['PLANNING', 'DEVELOPING', 'REVIEWING', 'BLOCKED']),
  initialState: () => ({
    currentStateMachineState: 'PLANNING',
    transcriptPath: '',
    issueNumbers: [],
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
      canTransitionTo: ['PLANNING', 'REVIEWING', 'BLOCKED'],
      allowedWorkflowOperations: [],
    },
    REVIEWING: {
      emoji: '🔎',
      agentInstructions: 'states/reviewing.md',
      canTransitionTo: ['DEVELOPING'],
      allowedWorkflowOperations: ['record-review'],
    },
    BLOCKED: {
      emoji: 'BLOCKED',
      agentInstructions: 'states/blocked.md',
      canTransitionTo: ['DEVELOPING'],
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
    args: [arg.state('STATE', z.enum(['PLANNING', 'DEVELOPING', 'REVIEWING', 'BLOCKED']))]
  },
  'record-issue': {
    type: 'transaction',
    args: [arg.string('ISSUE')],
    handler: (workflow, issue) => workflow.recordIssue(Number(issue)),
  },
}

const pluginRoot = mkdtempSync(join(tmpdir(), 'daw-opencode-smoke-'))
mkdirSync(join(pluginRoot, 'states'))
writeFileSync(join(pluginRoot, 'states', 'planning.md'), 'planning instructions')
writeFileSync(join(pluginRoot, 'states', 'developing.md'), 'developing instructions')
writeFileSync(join(pluginRoot, 'states', 'reviewing.md'), 'reviewing instructions')
writeFileSync(join(pluginRoot, 'states', 'blocked.md'), 'blocked instructions')
const workflowEventsPath = join(pluginRoot, 'workflow-events.db')
const opencodeDatabasePath = join(pluginRoot, 'opencode.db')
process.env['WORKFLOW_EVENTS_DB'] = workflowEventsPath
seedOpencodeTranscript(opencodeDatabasePath, 'session-1', '🧠 PLANNING proving OpenCode transcript parts are read')

try {
  const promptedTexts = []
  const sessionGetCalls = []
  const plugin = createOpenCodeWorkflowPlugin({
    workflowDefinition,
    routes,
    unknownCommandMessage: 'Run a supported workflow operation.',
    bashForbidden: { commands: ['rm'] },
    isWriteAllowed: (_filePath, state) => state.currentStateMachineState === 'DEVELOPING',
    pluginRoot,
    databasePath: opencodeDatabasePath,
    commandDirectories: [],
    commandPrefix: 'demo:',
    stopPreventionMessage: 'Follow the OpenCode recovery procedure.',
    buildWorkflowDeps: () => ({}),
  })

  const hooks = await plugin({
    client: {
      session: {
        get: async ({ path }) => {
          sessionGetCalls.push(path.id)
          if (path.id === 'child-session-1') {
            return { data: { id: 'child-session-1', parentID: 'session-1' } }
          }
          if (path.id === 'session-1') {
            return { data: { id: 'session-1' } }
          }
          throw new Error(`Unknown session ${path.id}`)
        },
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
  await beforeHook({
    tool: 'workflow',
    sessionID: 'session-1',
    callID: 'workflow-1',
  }, {
    args: {
      operation: 'record-issue',
      args: ['410'],
    },
  })
  const recordIssueOutput = await hooks.tool.workflow.execute({
    operation: 'record-issue',
    args: ['410'],
  }, ctx)
  const stateAfterRecordingIssue = readWorkflowState(workflowEventsPath, 'session-1')
  const workflowWriteCheckCount = readWriteCheckCount(workflowEventsPath, 'session-1', 'workflow')
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-1' },
    },
  })

  let blocked = false
  try {
    await beforeHook({
      tool: 'write',
      sessionID: 'session-1',
      callID: 'c1' 
    }, { args: { filePath: 'src/a.ts' } })
  } catch {
    blocked = true
  }
  let applyPatchBlocked = false
  try {
    await beforeHook({
      tool: 'apply_patch',
      sessionID: 'session-1',
      callID: 'apply-patch-1',
    }, { args: { patchText: '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: src/b.ts\n*** End Patch' } })
  } catch {
    applyPatchBlocked = true
  }
  let bashBlocked = false
  try {
    await beforeHook({
      tool: 'bash',
      sessionID: 'session-1',
      callID: 'bash-1',
    }, { args: { command: 'rm -rf build' } })
  } catch {
    bashBlocked = true
  }
  let questionBlocked = false
  try {
    await beforeHook({
      tool: 'question',
      sessionID: 'session-1',
      callID: 'question-1',
    }, { args: {} })
  } catch {
    questionBlocked = true
  }

  await hooks.tool.workflow.execute({
    operation: 'transition',
    args: ['DEVELOPING'] 
  }, ctx)
  const blockedTransitionOutput = await hooks.tool.workflow.execute({
    operation: 'transition',
    args: ['BLOCKED'],
  }, ctx)
  await hooks.tool.workflow.execute({
    operation: 'transition',
    args: ['DEVELOPING'],
  }, ctx)
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-1' },
    },
  })
  const identityStatus = readLatestIdentityStatus(workflowEventsPath, 'session-1')

  const writeError = await captureWorkflowError(() => beforeHook({
    tool: 'write',
    sessionID: 'session-1',
    callID: 'c2'
  }, { args: { filePath: 'src/a.ts' } }))
  const allowed = writeError === undefined
  const questionError = await captureWorkflowError(() => beforeHook({
    tool: 'question',
    sessionID: 'session-1',
    callID: 'question-2',
  }, { args: {} }))
  const questionAllowed = questionError === undefined
  const writeCheckCount = readWriteCheckCount(workflowEventsPath, 'session-1', 'write')
  const applyPatchWriteCheckCount = readWriteCheckCount(workflowEventsPath, 'session-1', 'apply_patch')

  await hooks.tool.workflow.execute({
    operation: 'transition',
    args: ['REVIEWING']
  }, ctx)
  const childStateOutput = await hooks.tool.workflow.execute({ operation: 'get-state' }, {
    ...ctx,
    sessionID: 'child-session-1',
  })
  const reviewOutput = await hooks.tool.workflow.execute({
    operation: 'record-review',
    args: ['platform-review', JSON.stringify({
      verdict: 'PASS',
      summary: 'No platform issues found.',
      findings: [],
    })],
  }, ctx)
  const missingPayloadError = await captureWorkflowError(() => hooks.tool.workflow.execute({
    operation: 'record-review',
    args: ['platform-review'],
  }, ctx))
  const invalidJsonError = await captureWorkflowError(() => hooks.tool.workflow.execute({
    operation: 'record-review',
    args: ['platform-review', '{'],
  }, ctx))
  await hooks.tool.workflow.execute({
    operation: 'transition',
    args: ['DEVELOPING']
  }, ctx)
  const blockedStateError = await captureWorkflowError(() => hooks.tool.workflow.execute({
    operation: 'record-review',
    args: ['platform-review', JSON.stringify({
      verdict: 'PASS',
      summary: 'No platform issues found.',
      findings: [],
    })],
  }, ctx))
  const reviewSummary = readReviewSummary(workflowEventsPath, 'session-1')

  if (
    !initOutput.includes('planning instructions')
    || !blocked
    || !applyPatchBlocked
    || !bashBlocked
    || !questionBlocked
    || !allowed
    || !questionAllowed
    || !recordIssueOutput.includes('record-issue')
    || !blockedTransitionOutput.includes('BLOCKED')
    || !stateAfterRecordingIssue.issueNumbers.includes(410)
    || workflowWriteCheckCount !== 0
    || writeCheckCount !== 2
    || applyPatchWriteCheckCount !== 1
    || identityStatus !== 'verified'
    || promptedTexts.length !== 1
    || !promptedTexts[0]?.startsWith('[Automatic Workflow Hook Response]')
    || !promptedTexts[0]?.includes('The user has not seen this')
    || !promptedTexts[0]?.endsWith('Follow the OpenCode recovery procedure.')
    || !childStateOutput.includes('"currentStateMachineState": "REVIEWING"')
    || !sessionGetCalls.includes('child-session-1')
    || !reviewOutput.includes('"ok": true')
    || missingPayloadError !== 'record-review requires <review-type> and <review-json> arguments'
    || !invalidJsonError?.includes('Invalid review JSON')
    || blockedStateError !== 'record-review is not allowed in state DEVELOPING.'
    || reviewSummary.reviewCount !== 1
    || reviewSummary.eventCount !== 1
    || reviewSummary.reviewRow?.review_type !== 'platform-review'
    || reviewSummary.reviewRow?.verdict !== 'PASS'
    || typeof reviewSummary.eventRow?.payload !== 'string'
  ) {
    throw new Error(`Smoke test failed: ${JSON.stringify({
      blocked,
      applyPatchBlocked,
      bashBlocked,
      questionBlocked,
      allowed,
      questionAllowed,
      recordIssueOutput,
      blockedTransitionOutput,
      stateAfterRecordingIssue,
      workflowWriteCheckCount,
      writeCheckCount,
      applyPatchWriteCheckCount,
      identityStatus,
      promptedTexts,
      initOutput,
      reviewOutput,
      missingPayloadError,
      invalidJsonError,
      blockedStateError,
      reviewSummary
    })}`)
  }
} finally {
  rmSync(pluginRoot, {
    recursive: true,
    force: true 
  })
}
