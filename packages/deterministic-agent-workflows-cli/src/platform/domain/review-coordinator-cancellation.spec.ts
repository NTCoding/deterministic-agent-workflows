import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach, describe, expect, it, vi
} from 'vitest'
import type { ReviewAgentRun } from './review-coordinator'
import { ReviewCoordinator } from './review-coordinator'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'

const directories: string[] = []
const request = {
  bundleId: 'bundle',
  sessionId: 'workflow',
  repository: 'owner/repository',
  workingDirectory: '/repository',
  pullRequestNumber: 42,
  baseRevision: 'base',
  headRevision: 'head',
  changedFiles: ['src/file.ts'],
  stateInstructions: 'Review the recorded change.',
  reviews: [{
    reviewType: 'custom-review',
    instructions: 'Inspect correctness.',
    version: 'v1',
  }],
}

function setup(cancel: () => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'coordinator-cancel-'))
  directories.push(directory)
  const store = createStore(join(directory, 'events.db'))
  const start = vi.fn(async (): Promise<ReviewAgentRun> => ({
    providerSessionId: 'provider-session',
    providerRunId: 'provider-run',
    completion: new Promise(() => undefined),
    cancel,
  }))
  const coordinator = new ReviewCoordinator({
    store,
    client: {
      start,
      load: vi.fn(),
      cancel: vi.fn(),
    },
    now: () => '2026-01-01T00:00:00.000Z',
  })
  return {
    store,
    start,
    coordinator,
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

describe('coordinator cancellation races', () => {
  it('returns cancellation to the running caller without waiting for a stalled completion', async () => {
    const cancel = vi.fn(async () => undefined)
    const fixture = setup(cancel)
    const running = fixture.coordinator.run(request, 'REVIEWING')
    await vi.waitFor(() => expect(fixture.store.listReviewAgents('bundle')[0]?.status).toBe('running'))
    await expect(fixture.coordinator.cancel('bundle', 'User cancelled.')).resolves.toMatchObject({ type: 'cancelled' })
    await expect(running).resolves.toMatchObject({ type: 'cancelled' })
    expect(cancel).toHaveBeenCalledOnce()
    fixture.store.db.close()
  })

  it('records cancellation transport failures rather than reporting successful cancellation', async () => {
    const fixture = setup(async () => { throw new TypeError('transport failed') })
    const running = fixture.coordinator.run(request, 'REVIEWING')
    await vi.waitFor(() => expect(fixture.store.listReviewAgents('bundle')[0]?.status).toBe('running'))
    await expect(fixture.coordinator.cancel('bundle', 'User cancelled.')).resolves.toMatchObject({
      type: 'failed',
      reason: 'Cancellation failed: TypeError: transport failed',
    })
    await expect(running).resolves.toMatchObject({ type: 'failed' })
    expect(fixture.store.getReviewBundle('bundle')?.status).toBe('failed')
    fixture.store.db.close()
  })

  it('shares an in-flight execution and serialises concurrent cancellation requests', async () => {
    const cancel = vi.fn(async () => undefined)
    const fixture = setup(cancel)
    const first = fixture.coordinator.run(request, 'REVIEWING')
    const second = fixture.coordinator.run(request, 'REVIEWING')
    await vi.waitFor(() => expect(fixture.store.listReviewAgents('bundle')[0]?.status).toBe('running'))
    await Promise.all([
      fixture.coordinator.cancel('bundle', 'First cancellation.'),
      fixture.coordinator.cancel('bundle', 'Second cancellation.'),
    ])
    await Promise.all([first, second])
    expect(fixture.start).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(fixture.store.listSessionReviews('workflow')).toStrictEqual([])
    fixture.store.db.close()
  })
})
