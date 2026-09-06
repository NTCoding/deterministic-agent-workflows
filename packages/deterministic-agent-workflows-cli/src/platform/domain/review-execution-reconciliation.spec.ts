import {
  expect, it, vi
} from 'vitest'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { ReviewCoordinator } from './review-coordinator'

const at = '2026-01-01T00:00:00.000Z'
const request = {
  bundleId: 'bundle',
  sessionId: 'workflow',
  repository: 'owner/repository',
  workingDirectory: '/repository',
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

it('reconciles a terminal bundle written between initial observation and ownership acquisition', async () => {
  const store = createStore(':memory:')
  const claim = store.claimReviewExecution
  const client = {
    start: vi.fn(),
    load: vi.fn(),
    cancel: vi.fn()
  }
  vi.spyOn(store, 'claimReviewExecution').mockImplementationOnce(bundleId => {
    store.claimReviewBundle(request, at)
    store.failReviewBundle(bundleId, 'Previous owner failed.', at)
    return claim(bundleId)
  })
  try {
    const coordinator = new ReviewCoordinator({
      store,
      client,
      now: () => at
    })
    await expect(coordinator.run(request, 'REVIEWING')).resolves.toMatchObject({
      type: 'failed',
      reason: 'Previous owner failed.'
    })
    expect(client.start).not.toHaveBeenCalled()
    const release = claim('bundle')
    release()
  } finally { store.db.close() }
})

it('rejects changed inputs observed after acquiring ownership and releases the claim', async () => {
  const store = createStore(':memory:')
  const claim = store.claimReviewExecution
  const client = {
    start: vi.fn(),
    load: vi.fn(),
    cancel: vi.fn()
  }
  vi.spyOn(store, 'claimReviewExecution').mockImplementationOnce(bundleId => {
    store.claimReviewBundle({
      ...request,
      headRevision: 'different-head'
    }, at)
    return claim(bundleId)
  })
  try {
    const coordinator = new ReviewCoordinator({
      store,
      client,
      now: () => at
    })
    await expect(coordinator.run(request, 'REVIEWING')).rejects.toThrow('cannot be resumed with different inputs')
    expect(client.start).not.toHaveBeenCalled()
    const release = claim('bundle')
    release()
  } finally { store.db.close() }
})

it('does not retain a rejected cancellation when the bundle is subsequently created', async () => {
  const store = createStore(':memory:')
  const coordinator = new ReviewCoordinator({
    store,
    client: {
      start: vi.fn(),
      load: vi.fn(),
      cancel: vi.fn()
    },
    now: () => at
  })
  try {
    await expect(coordinator.cancel('bundle', 'Before creation')).rejects.toThrow('not found')
    store.claimReviewBundle(request, at)
    await expect(coordinator.cancel('bundle', 'After creation')).resolves.toMatchObject({type: 'cancelled'})
  } finally { store.db.close() }
})


it('does not launch providers or mutate bundle state when execution ownership is unavailable', async () => {
  const store = createStore(':memory:')
  const client = {
    start: vi.fn(),
    load: vi.fn(),
    cancel: vi.fn()
  }
  vi.spyOn(store, 'claimReviewExecution').mockImplementationOnce(() => { throw new TypeError('Ownership backend unavailable.') })
  try {
    const coordinator = new ReviewCoordinator({
      store,
      client,
      now: () => at
    })
    await expect(coordinator.run(request, 'REVIEWING')).rejects.toThrow('Ownership backend unavailable.')
    expect({
      starts: client.start.mock.calls.length,
      loads: client.load.mock.calls.length,
      events: store.readEvents('workflow'),
      bundle: store.getReviewBundle('bundle')
    }).toStrictEqual({
      starts: 0,
      loads: 0,
      events: [],
      bundle: undefined
    })
  } finally { store.db.close() }
})
