import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expect, it, vi
} from 'vitest'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  ReviewCoordinator, type ReviewAgentClient, type ReviewAgentRun
} from './review-coordinator'

it('a competing connection cannot start the same reviewers or fail the winning bundle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-execution-'))
  const firstStore = createStore(join(directory, 'events.db'))
  const secondStore = createStore(join(directory, 'events.db'))
  const starts: Array<(run: ReviewAgentRun) => void> = []
  const client: ReviewAgentClient = {
    start: vi.fn(() => new Promise<ReviewAgentRun>((resolve) => starts.push(resolve))),
    load: vi.fn(),
    cancel: vi.fn(),
  }
  const request = {
    bundleId: 'bundle',
    sessionId: 'workflow',
    repository: 'owner/repository',
    workingDirectory: directory,
    pullRequestNumber: 42,
    baseRevision: 'base',
    headRevision: 'head',
    changedFiles: ['file.ts'],
    stateInstructions: 'Review the fixture.',
    reviews: ['one', 'two', 'three', 'four'].map(reviewType => ({
      reviewType,
      instructions: 'Inspect the change.',
      version: '1'
    })),
  }
  const first = new ReviewCoordinator({
    store: firstStore,
    client,
    now: () => new Date().toISOString()
  })
  const second = new ReviewCoordinator({
    store: secondStore,
    client,
    now: () => new Date().toISOString()
  })
  try {
    const winningRun = first.run(request, 'REVIEWING')
    const observedEvents = firstStore.readEvents('workflow')
    await expect(second.run(request, 'REVIEWING')).rejects.toThrow('Unable to claim SQLite exclusive lock')
    expect(secondStore.readEvents('workflow')).toStrictEqual(observedEvents)
    expect(client.start).toHaveBeenCalledTimes(4)
    starts.forEach((resolve, index) => resolve({
      providerSessionId: `session-${index}`,
      providerRunId: `run-${index}`,
      completion: Promise.resolve({
        verdict: 'PASS',
        findings: []
      }),
      cancel: async () => undefined
    }))
    await expect(winningRun).resolves.toMatchObject({type: 'completed'})
  } finally {
    firstStore.db.close()
    secondStore.db.close()
    rmSync(directory, {
      recursive: true,
      force: true
    })
  }
})

it('a foreign coordinator cannot cancel an owned bundle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-cancel-ownership-'))
  const firstStore = createStore(join(directory, 'events.db'))
  const secondStore = createStore(join(directory, 'events.db'))
  const cancel = vi.fn(async () => undefined)
  const client: ReviewAgentClient = {
    start: async () => ({
      providerSessionId: 'provider',
      providerRunId: 'run',
      completion: new Promise(() => undefined),
      cancel
    }),
    load: vi.fn(),
    cancel: vi.fn(),
  }
  const request = {
    bundleId: 'bundle',
    sessionId: 'workflow',
    repository: 'owner/repository',
    workingDirectory: directory,
    pullRequestNumber: 42,
    baseRevision: 'base',
    headRevision: 'head',
    changedFiles: ['file.ts'],
    stateInstructions: 'Review the fixture.',
    reviews: [{
      reviewType: 'one',
      instructions: 'Inspect.',
      version: '1'
    }],
  }
  const first = new ReviewCoordinator({
    store: firstStore,
    client,
    now: () => new Date().toISOString()
  })
  const second = new ReviewCoordinator({
    store: secondStore,
    client,
    now: () => new Date().toISOString()
  })
  try {
    const running = first.run(request, 'REVIEWING')
    await vi.waitFor(() => expect(firstStore.listReviewAgents('bundle')[0]?.status).toBe('running'))
    const events = firstStore.readEvents('workflow')
    await expect(second.cancel('bundle', 'Foreign cancellation')).rejects.toThrow('Unable to claim SQLite exclusive lock')
    expect({
      events: secondStore.readEvents('workflow'),
      remoteCancellations: vi.mocked(client.cancel).mock.calls.length,
      localCancellations: cancel.mock.calls.length,
    }).toMatchObject({
      events,
      remoteCancellations: 0,
      localCancellations: 0
    })
    const outcomes = await Promise.all([first.cancel('bundle', 'Owner cancellation'), running])
    const release = secondStore.claimReviewExecution('bundle')
    release()
    expect({
      outcomes,
      cancellations: cancel.mock.calls.length
    }).toMatchObject({
      outcomes: [{type: 'cancelled'}, {type: 'cancelled'}],
      cancellations: 1
    })
  } finally {
    firstStore.db.close(); secondStore.db.close()
    rmSync(directory, {
      recursive: true,
      force: true
    })
  }
})


it('releases ownership when cancelling a missing bundle fails', async () => {
  const store = createStore(':memory:')
  const coordinator = new ReviewCoordinator({
    store,
    client: {
      start: vi.fn(),
      load: vi.fn(),
      cancel: vi.fn()
    },
    now: () => new Date().toISOString()
  })
  try {
    await expect(coordinator.cancel('missing', 'Missing bundle')).rejects.toThrow('not found')
    const release = store.claimReviewExecution('missing')
    release()
  } finally { store.db.close() }
})
