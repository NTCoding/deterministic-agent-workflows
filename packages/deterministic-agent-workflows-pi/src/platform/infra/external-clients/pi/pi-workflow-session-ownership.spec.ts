import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { createPiWorkflowSessionOwnership } from '../../../../features/pi-extension/entrypoint/pi-workflow-session-ownership'

const workspace = {
  directory: '',
  databasePath: '',
}

beforeEach(() => {
  workspace.directory = mkdtempSync(join(tmpdir(), 'pi-session-ownership-'))
  workspace.databasePath = join(workspace.directory, 'workflow.db')
})

afterEach(() => {
  rmSync(workspace.directory, {
    recursive: true,
    force: true,
  })
})

function seedWorkflowSession(sessionId: string): void {
  const store = createStore(workspace.databasePath)
  try {
    store.appendEvents(sessionId, [{
      envelope: {
        type: 'session-started',
        at: '2026-01-01T00:00:00.000Z',
        state: 'PLANNING',
      },
      payload: {
        transcriptPath: '/sessions/session.jsonl',
        repository: 'owner/repository',
        currentState: 'PLANNING',
        states: ['PLANNING'],
      },
    }])
  } finally {
    store.db.close()
  }
}

describe('pi workflow session ownership context successors', () => {
  it('resolves a recorded successor session to its retired workflow session', () => {
    const ownership = createPiWorkflowSessionOwnership(workspace.databasePath)
    seedWorkflowSession('retired-session')

    expect(ownership.contextPredecessor('fresh-session')).toBeUndefined()
    ownership.recordContextSuccessor('fresh-session', 'retired-session', '2026-01-01T00:01:00.000Z')

    expect(ownership.contextPredecessor('fresh-session')).toBe('retired-session')
    expect(ownership.resolveWorkflowSessionId('fresh-session')).toBe('retired-session')
    expect(ownership.resolveWorkflowSessionId('retired-session')).toBe('retired-session')
  })

  it('keeps successor records durable across independent database connections', () => {
    const ownership = createPiWorkflowSessionOwnership(workspace.databasePath)
    seedWorkflowSession('retired-session')
    ownership.recordContextSuccessor('fresh-session', 'retired-session', '2026-01-01T00:01:00.000Z')

    const reopened = createPiWorkflowSessionOwnership(workspace.databasePath)
    expect(reopened.contextPredecessor('fresh-session')).toBe('retired-session')
    expect(reopened.hasPersistedWorkflow('fresh-session')).toBe(true)
    expect(reopened.usesInheritedWorkflow('fresh-session')).toBe(true)
    expect(reopened.resolveWorkflowSessionId('fresh-session')).toBe('retired-session')
  })

  it('grants a successor access to the retired session workflow and refuses unknown parents', () => {
    const ownership = createPiWorkflowSessionOwnership(workspace.databasePath)
    seedWorkflowSession('retired-session')
    ownership.recordContextSuccessor('fresh-session', 'retired-session', '2026-01-01T00:01:00.000Z')

    const store = createStore(workspace.databasePath)
    try {
      expect(() => ownership.requireAccess(store, 'fresh-session')).not.toThrow()
      ownership.recordContextSuccessor('orphan-session', 'missing-session', '2026-01-01T00:02:00.000Z')
      expect(() => ownership.requireAccess(store, 'orphan-session')).toThrow('has no persisted workflow')
    } finally {
      store.db.close()
    }
  })

  it('leaves sessions without successors or delegation on their own workflow session', () => {
    const ownership = createPiWorkflowSessionOwnership(workspace.databasePath)
    seedWorkflowSession('own-session')

    expect(ownership.contextPredecessor('own-session')).toBeUndefined()
    expect(ownership.resolveWorkflowSessionId('own-session')).toBe('own-session')
    expect(ownership.usesInheritedWorkflow('own-session')).toBe(false)
    expect(ownership.hasPersistedWorkflow('own-session')).toBe(true)
  })
})
