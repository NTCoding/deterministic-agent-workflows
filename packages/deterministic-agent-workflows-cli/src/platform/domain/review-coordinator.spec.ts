import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach, describe, expect, it, vi
} from 'vitest'
import type {
  ReviewBundleRequest,
  ReviewPayload,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import {
  ReviewCoordinator,
  type ReviewAgentClient,
  type ReviewAgentRequest,
  type ReviewAgentRun,
} from './review-coordinator'

const temporaryDirectories: string[] = []

function createTestStore() {
  const directory = mkdtempSync(join(tmpdir(), 'review-coordinator-'))
  temporaryDirectories.push(directory)
  return createStore(join(directory, 'events.db'))
}

function request(bundleId = 'bundle-1'): ReviewBundleRequest {
  return {
    bundleId,
    sessionId: 'session-1',
    repository: 'owner/repository',
    workingDirectory: '/repository',
    pullRequestNumber: 42,
    baseRevision: 'base-sha',
    headRevision: 'head-sha',
    changedFiles: ['src/a.ts', 'src/b.ts'],
    stateInstructions: 'Follow the reviewing state.',
    reviews: ['one', 'two', 'three', 'four'].map((reviewType) => ({
      reviewType,
      instructions: `Run ${reviewType}.`,
      version: 'v1',
    })),
  }
}

function pass(): ReviewPayload {
  return {
    verdict: 'PASS',
    summary: 'No findings.',
    findings: [],
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true
    })
  }
})

describe('ReviewCoordinator', () => {
  it('starts every consumer-defined reviewer concurrently with exact files', async () => {
    const store = createTestStore()
    const requests: ReviewAgentRequest[] = []
    const resolvers: Array<(result: ReviewPayload) => void> = []
    const client: ReviewAgentClient = {
      async start(input): Promise<ReviewAgentRun> {
        requests.push(input)
        const completion = new Promise<ReviewPayload>((resolve) => resolvers.push(resolve))
        return {
          providerSessionId: `provider-${input.reviewType}`,
          providerRunId: `run-${input.reviewType}`,
          completion,
          cancel: vi.fn(async () => undefined),
        }
      },
      load: vi.fn(),
      cancel: vi.fn(),
    }
    const coordinator = new ReviewCoordinator({
      store,
      client,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const completion = coordinator.run(request(), 'REVIEWING')
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    expect(requests[0]?.prompt).toContain('Files to Review:\n- src/a.ts\n- src/b.ts')
    for (const resolve of resolvers) resolve(pass())

    await expect(completion).resolves.toMatchObject({
      type: 'completed',
      bundle: { status: 'completed' },
    })
    expect(store.listSessionReviews('session-1')).toHaveLength(4)
    store.db.close()
  })

  it('rejects a second active bundle for the same pull request', async () => {
    const store = createTestStore()
    const client: ReviewAgentClient = {
      async start(input): Promise<ReviewAgentRun> {
        return {
          providerSessionId: `provider-${input.reviewType}`,
          providerRunId: `run-${input.reviewType}`,
          completion: new Promise<ReviewPayload>(() => undefined),
          cancel: vi.fn(async () => undefined),
        }
      },
      load: vi.fn(),
      cancel: vi.fn(),
    }
    const coordinator = new ReviewCoordinator({
      store,
      client,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    void coordinator.run(request('bundle-1'), 'REVIEWING')
    await vi.waitFor(() => expect(
      store.findActiveReviewBundle('owner/repository', 42),
    ).toBeDefined())

    await expect(coordinator.run(request('bundle-2'), 'REVIEWING')).rejects.toThrow(
      'already has active review bundle bundle-1',
    )
    await expect(coordinator.run({
      ...request('bundle-1'),
      headRevision: 'different-head',
    }, 'REVIEWING')).rejects.toThrow(
      'cannot be resumed with different inputs',
    )
    store.db.close()
  })

  it('fails the bundle and cancels started agents when launch fails', async () => {
    const store = createTestStore()
    const cancel = vi.fn(async () => undefined)
    const client: ReviewAgentClient = {
      async start(input): Promise<ReviewAgentRun> {
        if (input.reviewType === 'two') throw new TypeError('agent unavailable')
        return {
          providerSessionId: `provider-${input.reviewType}`,
          providerRunId: `run-${input.reviewType}`,
          completion: Promise.resolve(pass()),
          cancel,
        }
      },
      load: vi.fn(),
      cancel: vi.fn(),
    }
    const coordinator = new ReviewCoordinator({
      store,
      client,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    await expect(coordinator.run(request(), 'REVIEWING')).resolves.toMatchObject({
      type: 'failed',
      reason: 'Unable to start review bundle: TypeError: agent unavailable',
      bundle: { status: 'failed' },
    })
    expect(cancel).toHaveBeenCalledTimes(3)
    expect(store.listReviewAgents('bundle-1').every((agent) => agent.status === 'failed')).toBe(true)
    store.db.close()
  })

  it('loads persisted provider sessions after coordinator restart', async () => {
    const store = createTestStore()
    const input = request()
    store.claimReviewBundle(input, '2026-01-01T00:00:00.000Z')
    store.markReviewBundleRunning(input.bundleId, '2026-01-01T00:00:01.000Z')
    for (const definition of input.reviews) {
      store.markReviewAgentRunning(
        input.bundleId,
        definition.reviewType,
        `persisted-${definition.reviewType}`,
        `original-run-${definition.reviewType}`,
        '2026-01-01T00:00:02.000Z',
      )
    }
    const load = vi.fn(async (
      _agentRequest: ReviewAgentRequest,
      providerSessionId: string,
    ): Promise<ReviewAgentRun> => ({
      providerSessionId,
      providerRunId: `resumed-${providerSessionId}`,
      completion: Promise.resolve(pass()),
      cancel: vi.fn(async () => undefined),
    }))
    const coordinator = new ReviewCoordinator({
      store,
      client: {
        start: vi.fn(),
        load,
        cancel: vi.fn(),
      },
      now: () => '2026-01-01T00:00:03.000Z',
    })

    await expect(coordinator.run(input, 'REVIEWING')).resolves.toMatchObject({type: 'completed',})
    expect(load).toHaveBeenCalledTimes(4)
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ reviewType: 'one' }),
      'persisted-one',
    )
    store.db.close()
  })

  it('cancels active provider sessions idempotently', async () => {
    const store = createTestStore()
    const input = request()
    store.claimReviewBundle(input, '2026-01-01T00:00:00.000Z')
    store.markReviewBundleRunning(input.bundleId, '2026-01-01T00:00:01.000Z')
    store.markReviewAgentRunning(
      input.bundleId,
      'one',
      'provider-one',
      'run-one',
      '2026-01-01T00:00:02.000Z',
    )
    const cancel = vi.fn(async () => undefined)
    const coordinator = new ReviewCoordinator({
      store,
      client: {
        start: vi.fn(),
        load: vi.fn(),
        cancel,
      },
      now: () => '2026-01-01T00:00:03.000Z',
    })

    await expect(coordinator.cancel(input.bundleId, 'User cancelled.')).resolves.toMatchObject({
      type: 'cancelled',
      bundle: { status: 'cancelled' },
    })
    await expect(coordinator.cancel(input.bundleId, 'Repeated cancellation.')).resolves.toMatchObject({type: 'cancelled',})
    expect(cancel).toHaveBeenCalledOnce()
    expect(store.listReviewAgents(input.bundleId).every(
      (agent) => agent.status === 'cancelled',
    )).toBe(true)
    store.db.close()
  })
})
