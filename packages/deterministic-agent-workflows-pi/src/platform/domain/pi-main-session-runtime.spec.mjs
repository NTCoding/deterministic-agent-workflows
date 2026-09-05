import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  expect, it, vi
} from 'vitest'
import { replaceWithFreshPiSession } from './pi-main-session.ts'

it('uses the installed Pi runtime to dispose the old session and initialise a clean durable owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-runtime-proof-'))
  const databasePath = join(root, 'events.db')
  const promptSnapshots = []
  const createRuntime = async (options) => {
    const services = await createAgentSessionServices({
      cwd: options.cwd,
      agentDir: options.agentDir,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      },
    })
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      sessionStartEvent: options.sessionStartEvent,
      noTools: 'all',
    })
    vi.spyOn(created.session, 'prompt').mockImplementation(async (instructions) => {
      const store = createStore(databasePath)
      try {
        promptSnapshots.push({
          instructions,
          messages: [...created.session.messages],
          owner: store.requireWorkflowSessionAccess(created.session.sessionId),
          events: store.readEvents(created.session.sessionId),
        })
      } finally {
        store.db.close()
      }
    })
    return {
      ...created,
      services,
      diagnostics: services.diagnostics,
    }
  }
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: root,
    agentDir: join(root, 'agent'),
    sessionManager: SessionManager.create(root, join(root, 'sessions')),
  })
  try {
    const oldSession = runtime.session
    const oldId = oldSession.sessionId
    await oldSession.sendCustomMessage({
      customType: 'implementation-context',
      content: 'Old implementation context must not be copied.',
      display: true,
    }, { triggerTurn: false })
    const retiredNotifications = vi.fn()
    oldSession.subscribe(retiredNotifications)
    const dispose = vi.spyOn(oldSession, 'dispose')
    const store = createStore(databasePath)
    store.appendEvents(oldId, [{
      envelope: {
        type: 'session-started',
        at: '2026-01-01T00:00:00.000Z',
        state: 'PLANNING',
      },
      payload: {
        transcriptPath: oldSession.sessionFile,
        repository: 'owner/repository',
      },
    }])
    store.db.close()
    const result = await replaceWithFreshPiSession(runtime, 'Enter the recorded workflow state.', databasePath)
    await runtime.session.sendCustomMessage({
      customType: 'fresh-context',
      content: 'New context only.',
      display: true,
    }, { triggerTurn: false })
    expect({
      disposals: dispose.mock.calls.length,
      retiredNotifications: retiredNotifications.mock.calls.length,
    }).toStrictEqual({
      disposals: 1,
      retiredNotifications: 0,
    })
    expect(result.sessionId).not.toBe(oldId)
    expect(promptSnapshots).toMatchObject([{
      instructions: 'Enter the recorded workflow state.',
      messages: [],
      owner: oldId,
      events: [
        { envelope: { type: 'session-started' } },
        { envelope: { type: 'workflow-session-owner-transferred' } },
      ],
    }])
    const reopened = createStore(databasePath)
    try {
      expect(() => reopened.requireWorkflowSessionAccess(oldId)).toThrow('not the current workflow owner')
    } finally {
      reopened.db.close()
    }
  } finally {
    await runtime.dispose()
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})
