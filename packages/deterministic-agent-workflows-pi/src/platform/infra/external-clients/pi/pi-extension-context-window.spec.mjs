import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import {
  expect, it, vi
} from 'vitest'
import { createPiExtensionContextWindow } from './pi-extension-context-window.ts'

function assistant(text) {
  return {
    role: 'assistant',
    content: [{
      type: 'text',
      text
    }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4o-mini',
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
        total: 0
      },
    },
    stopReason: 'stop',
    timestamp: 2,
  }
}

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'pi-extension-context-'))
  const manager = SessionManager.create(root, join(root, 'sessions'))
  manager.appendMessage({
    role: 'user',
    content: 'OLD USER CONTEXT',
    timestamp: 1
  })
  manager.appendMessage(assistant('OLD IMPLEMENTATION CONTEXT'))
  const requests = []
  let refresh
  const services = await createAgentSessionServices({
    cwd: root,
    agentDir: join(root, 'agent'),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: 'NORMAL REPOSITORY INSTRUCTIONS',
      extensionFactories: [(pi) => {
        const refreshContext = createPiExtensionContextWindow(pi)
        pi.on('session_start', (_event, ctx) => {
          refresh = (instructions) => refreshContext(ctx, instructions)
        })
      }],
    },
  })
  await services.modelRuntime.setRuntimeApiKey('openai', 'fixture-not-a-real-key')
  async function open(sessionManager) {
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      noTools: 'all',
      model: services.modelRuntime.getModel('openai', 'gpt-4o-mini'),
    })
    await session.bindExtensions({})
    session.agent.streamFunction = (_model, context) => {
      requests.push(structuredClone(context))
      const response = assistant('NEW ASSISTANT RESPONSE')
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'done',
            reason: 'stop',
            message: response
          }
        },
        result: async () => response,
      }
    }
    return session
  }
  const session = await open(manager)
  try {
    await run({
      session,
      refresh: (instructions) => refresh(instructions),
      requests,
      open
    })
  } finally {
    session.dispose()
    rmSync(root, {
      recursive: true,
      force: true
    })
  }
}

it('gives the actual model only state instructions and subsequent messages, including after reopening', async () => {
  await fixture(async ({
    session, refresh, requests, open
  }) => {
    const id = session.sessionId
    const systemPrompt = session.systemPrompt
    const file = session.sessionFile
    const originalEntries = session.sessionManager.getEntries()
    refresh('STATE: ADDRESSING_FEEDBACK')
    await session.prompt('NEW USER REQUEST')
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0])).not.toContain('OLD ')
    expect(JSON.stringify(requests[0])).toContain('STATE: ADDRESSING_FEEDBACK')
    expect(JSON.stringify(requests[0])).toContain('NEW USER REQUEST')
    expect(requests[0].systemPrompt).toBe(systemPrompt)
    expect(requests[0].systemPrompt).toContain('NORMAL REPOSITORY INSTRUCTIONS')
    const reopenedManager = SessionManager.open(file)
    expect(reopenedManager.getEntries().slice(0, originalEntries.length)).toStrictEqual(originalEntries)
    expect(reopenedManager.getSessionId()).toBe(id)
    const reopened = await open(reopenedManager)
    try {
      await reopened.prompt('AFTER REOPEN')
      expect(JSON.stringify(requests[1])).not.toContain('OLD ')
      expect(JSON.stringify(requests[1])).toContain('NEW ASSISTANT RESPONSE')
      refresh('STATE: REFLECTING')
      await reopened.prompt('REFLECT NOW')
      expect(JSON.stringify(requests[2])).not.toContain('ADDRESSING_FEEDBACK')
      expect(JSON.stringify(requests[2])).not.toContain('AFTER REOPEN')
      expect(JSON.stringify(requests[2])).toContain('STATE: REFLECTING')
      expect(reopened.sessionId).toBe(id)
      expect(reopened.sessionFile).toBe(file)
    } finally {
      reopened.dispose()
    }
  })
})

it('fails refresh without changing the model context when persistence fails', async () => {
  await fixture(async ({
    session, refresh, requests
  }) => {
    const append = vi.spyOn(session.sessionManager, 'appendCustomEntry').mockImplementation(() => {
      throw new Error('disk unavailable')
    })
    expect(() => refresh('STATE: ADDRESSING_FEEDBACK')).toThrow('disk unavailable')
    append.mockRestore()
    await session.prompt('CONTINUE ORIGINAL CONTEXT')
    expect(JSON.stringify(requests[0])).toContain('OLD USER CONTEXT')
    expect(JSON.stringify(requests[0])).not.toContain('STATE: ADDRESSING_FEEDBACK')
  })
})

it('rejects empty instructions, busy sessions, and unpersisted sessions before creating a boundary', async () => {
  await fixture(async ({
    session, refresh
  }) => {
    const entries = session.sessionManager.getEntries()
    expect(() => refresh(' ')).toThrow('must not be empty')
    const idle = vi.spyOn(session, 'isIdle', 'get').mockReturnValue(false)
    expect(() => refresh('STATE')).toThrow('until the session is idle')
    idle.mockRestore()
    const file = vi.spyOn(session.sessionManager, 'getSessionFile').mockReturnValue(undefined)
    expect(() => refresh('STATE')).toThrow('persisted session')
    file.mockRestore()
    expect(session.sessionManager.getEntries()).toStrictEqual(entries)
  })
})

it('does not resurrect retired messages or generate a handover when Pi compacts later', async () => {
  await fixture(async ({
    session, refresh, requests
  }) => {
    await session.sendCustomMessage({
      customType: 'fixture-history',
      content: 'OLD LARGE IMPLEMENTATION HISTORY '.repeat(8000),
      display: false,
    }, { triggerTurn: false })
    refresh('STATE: ADDRESSING_FEEDBACK')
    await session.sendCustomMessage({
      customType: 'current-feedback',
      content: 'NEW FEEDBACK TO RETAIN',
      display: true,
    }, { triggerTurn: false })
    await session.compact()
    expect(requests).toStrictEqual([])
    await session.prompt('CONTINUE AFTER COMPACTION')
    expect(JSON.stringify(requests[0])).not.toContain('OLD ')
    expect(JSON.stringify(requests[0])).toContain('NEW FEEDBACK TO RETAIN')
    expect(JSON.stringify(requests[0])).toContain('STATE: ADDRESSING_FEEDBACK')
    expect(JSON.stringify(session.sessionManager.getEntries())).toContain('OLD LARGE IMPLEMENTATION HISTORY')
  })
})
