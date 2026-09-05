import {
  describe, expect, it, vi 
} from 'vitest'
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
    const previousSession = runtime.session

    await expect(replaceWithFreshPiSession(runtime, 'Enter ADDRESSING_FEEDBACK.')).resolves.toStrictEqual({
      previousSessionId: 'current-session',
      sessionId: 'fresh-session',
    })
    expect(runtime.newSession).toHaveBeenCalledOnce()
    expect(previousSession.prompt).not.toHaveBeenCalled()
    expect(runtime.session.prompt).toHaveBeenCalledWith('Enter ADDRESSING_FEEDBACK.')
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
