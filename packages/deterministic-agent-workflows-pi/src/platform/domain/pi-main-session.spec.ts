import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describe, expect, it, vi
} from 'vitest'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  replaceWithFreshPiSession,
  resolvePiMainSessionId,
  type PiFreshSessionRuntime,
} from './pi-main-session'

function runtimeFixture(options: {
  readonly current?: string
  readonly next?: string
  readonly streaming?: boolean
  readonly cancelled?: boolean
} = {}): PiFreshSessionRuntime {
  const state = {
    session: {
      sessionId: options.current ?? 'current-session',
      isStreaming: options.streaming ?? false,
      prompt: vi.fn(async () => undefined),
    },
  }
  return {
    get session() {
      return state.session
    },
    newSession: vi.fn(async () => {
      if (options.cancelled !== true) {
        state.session = {
          sessionId: options.next ?? 'fresh-session',
          isStreaming: false,
          prompt: vi.fn(async () => undefined),
        }
      }
      return { cancelled: options.cancelled ?? false }
    }),
  }
}

function workflowDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pi-owner-'))
  const path = join(directory, 'events.db')
  const store = createStore(path)
  store.appendEvents('current-session', [{
    envelope: {
      type: 'session-started',
      at: '2026-01-01T00:00:00.000Z',
      state: 'PLANNING',
    },
    payload: {
      transcriptPath: '/session.jsonl',
      repository: 'owner/repository',
      currentState: 'PLANNING',
      states: ['PLANNING'],
    },
  }])
  store.db.close()
  return path
}

describe('resolvePiMainSessionId', () => {
  it('uses the current session for a main Pi process', () => {
    expect(resolvePiMainSessionId(' current ', {})).toBe('current')
  })

  it('uses the runtime-provided parent for a child process', () => {
    expect(resolvePiMainSessionId('child', {PI_SUBAGENT_PARENT_SESSION: ' parent ',})).toBe('parent')
  })

  it('rejects a blank runtime-provided parent', () => {
    expect(() => resolvePiMainSessionId('child', {PI_SUBAGENT_PARENT_SESSION: ' ',})).toThrow('PI_SUBAGENT_PARENT_SESSION must contain a non-empty session UUID.')
  })

  it('rejects a blank current session', () => {
    expect(() => resolvePiMainSessionId(' ', {})).toThrow('Pi returned an empty session UUID.')
  })
})

describe('replaceWithFreshPiSession', () => {
  it('uses the supported runtime replacement API and returns the ownership change', async () => {
    const runtime = runtimeFixture()
    const path = workflowDatabase()
    await expect(replaceWithFreshPiSession(
      runtime,
      'Enter ADDRESSING_FEEDBACK.',
      path,
    )).resolves.toStrictEqual({
      previousSessionId: 'current-session',
      sessionId: 'fresh-session',
    })
    const store = createStore(path)
    expect(store.requireWorkflowSessionAccess('fresh-session')).toBe('current-session')
    expect(() => store.requireWorkflowSessionAccess('current-session')).toThrow(
      'not the current workflow owner',
    )
    expect(store.readEvents('fresh-session').at(-1)?.envelope.type).toBe(
      'workflow-session-owner-transferred',
    )
    store.db.close()
    rmSync(join(path, '..'), {
      recursive: true,
      force: true
    })
  })

  it('rejects replacement while the current session is streaming', async () => {
    await expect(replaceWithFreshPiSession(
      runtimeFixture({ streaming: true }),
      'Enter ADDRESSING_FEEDBACK.',
    )).rejects.toThrow(
      'Cannot replace a streaming Pi session.',
    )
  })

  it('rejects cancellation and unchanged session identity', async () => {
    await expect(replaceWithFreshPiSession(
      runtimeFixture({ cancelled: true }),
      'Enter ADDRESSING_FEEDBACK.',
    )).rejects.toThrow(
      'Pi fresh-session replacement was cancelled.',
    )
    await expect(replaceWithFreshPiSession(
      runtimeFixture({ next: 'current-session' }),
      'Enter ADDRESSING_FEEDBACK.',
    )).rejects.toThrow(
      'Pi fresh-session replacement retained the previous session UUID.',
    )
  })

  it('rejects empty state instructions before replacing the session', async () => {
    const runtime = runtimeFixture()

    await expect(replaceWithFreshPiSession(runtime, ' ')).rejects.toThrow(
      'Fresh Pi session state instructions must not be empty.',
    )
    expect(runtime.newSession).not.toHaveBeenCalled()
  })
})
