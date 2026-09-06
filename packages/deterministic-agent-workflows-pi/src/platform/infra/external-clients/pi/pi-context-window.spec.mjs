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
import { refreshPiContextWindow } from './pi-context-window.ts'

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'pi-context-window-'))
  const manager = SessionManager.create(root, join(root, 'sessions'))
  manager.appendMessage({
    role: 'user',
    content: 'OLD IMPLEMENTATION CONTEXT',
    timestamp: 1
  })
  manager.appendMessage({
    role: 'assistant',
    content: [{
      type: 'text',
      text: 'OLD IMPLEMENTATION ANSWER'
    }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'fixture',
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
  })
  const services = await createAgentSessionServices({
    cwd: root,
    agentDir: join(root, 'agent'),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    },
  })
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: manager,
    noTools: 'all',
  })
  try {
    await run(session)
  } finally {
    session.dispose()
    rmSync(root, {
      recursive: true,
      force: true
    })
  }
}

it('refreshes context while retaining the same live session and complete transcript after reopen', async () => {
  await fixture(async (session) => {
    const id = session.sessionId
    const file = session.sessionFile
    const transcript = session.sessionManager.getEntries()
    const dispose = vi.spyOn(session, 'dispose')
    refreshPiContextWindow(session, 'STATE: ADDRESSING_FEEDBACK')
    expect({
      id: session.sessionId,
      file: session.sessionFile,
      disposals: dispose.mock.calls.length
    })
      .toStrictEqual({
        id,
        file,
        disposals: 0
      })
    expect(session.messages).toMatchObject([{
      role: 'compactionSummary',
      summary: 'STATE: ADDRESSING_FEEDBACK'
    }])
    const reopened = SessionManager.open(file)
    expect({
      id: reopened.getSessionId(),
      transcript: reopened.getEntries().slice(0, transcript.length)
    })
      .toStrictEqual({
        id,
        transcript
      })
    expect(reopened.buildSessionContext().messages).toStrictEqual(session.messages)
  })
})

it('keeps subsequent messages in the fresh window and replaces that window on the next refresh', async () => {
  await fixture(async (session) => {
    refreshPiContextWindow(session, 'STATE: ADDRESSING_FEEDBACK')
    await session.sendCustomMessage({
      customType: 'feedback',
      content: 'NEW FEEDBACK',
      display: true
    }, { triggerTurn: false })
    expect(JSON.stringify(session.messages)).toContain('NEW FEEDBACK')
    refreshPiContextWindow(session, 'STATE: REFLECTING')
    expect(session.messages).toMatchObject([{
      role: 'compactionSummary',
      summary: 'STATE: REFLECTING'
    }])
    expect(JSON.stringify(session.messages)).not.toContain('NEW FEEDBACK')
    expect(JSON.stringify(session.sessionManager.getEntries())).toContain('NEW FEEDBACK')
  })
})

it('rejects blank instructions and busy sessions before changing persisted entries', async () => {
  await fixture(async (session) => {
    const entries = session.sessionManager.getEntries()
    expect(() => refreshPiContextWindow(session, ' ')).toThrow('must not be empty')
    vi.spyOn(session, 'isIdle', 'get').mockReturnValue(false)
    expect(() => refreshPiContextWindow(session, 'STATE')).toThrow('until the session is idle')
    expect(session.sessionManager.getEntries()).toStrictEqual(entries)
  })
})

it('propagates persistence failure without replacing the active context', async () => {
  await fixture(async (session) => {
    const messages = [...session.messages]
    vi.spyOn(session.sessionManager, 'appendCompaction').mockImplementation(() => { throw new TypeError('disk unavailable') })
    expect(() => refreshPiContextWindow(session, 'STATE')).toThrow('disk unavailable')
    expect(session.messages).toStrictEqual(messages)
  })
})
