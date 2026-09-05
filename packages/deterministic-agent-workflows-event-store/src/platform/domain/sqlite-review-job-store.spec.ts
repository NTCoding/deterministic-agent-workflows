import {
  mkdtempSync, rmSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach, describe, expect, it 
} from 'vitest'
import {
  engineEventSchema,
  type ReviewBundleRequest,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createStore } from './sqlite-event-store'

const directories: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'review-job-store-'))
  directories.push(directory)
  return join(directory, 'events.db')
}

function request(bundleId: string, pullRequestNumber = 42): ReviewBundleRequest {
  return {
    bundleId,
    sessionId: 'session-1',
    repository: 'owner/repository',
    workingDirectory: '/repository',
    pullRequestNumber,
    baseRevision: 'base-sha',
    headRevision: 'head-sha',
    changedFiles: ['src/file.ts'],
    stateInstructions: 'Review the change.',
    reviews: [{
      reviewType: 'custom-review',
      instructions: 'Inspect correctness.' 
    }],
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true 
    })
  }
})

describe('SQLite review job store', () => {
  it('enforces one active bundle per repository pull request', () => {
    const store = createStore(databasePath())
    store.claimReviewBundle(request('bundle-1'), '2026-01-01T00:00:00.000Z')

    expect(() => store.claimReviewBundle(
      request('bundle-2'),
      '2026-01-01T00:00:01.000Z',
    )).toThrow('UNIQUE constraint failed')
    expect(store.findActiveReviewBundle('owner/repository', 42)?.bundleId).toBe('bundle-1')
    store.db.close()
  })

  it('recovers an active bundle after reopening the database', () => {
    const path = databasePath()
    const first = createStore(path)
    first.claimReviewBundle(request('bundle-1'), '2026-01-01T00:00:00.000Z')
    first.markReviewBundleRunning('bundle-1', '2026-01-01T00:00:01.000Z')
    first.db.close()

    const recovered = createStore(path)
    expect(recovered.findActiveReviewBundle('owner/repository', 42)).toMatchObject({
      bundleId: 'bundle-1',
      status: 'running',
    })
    recovered.db.close()
  })

  it('atomically records reviewer completion and public lifecycle events', () => {
    const store = createStore(databasePath())
    store.claimReviewBundle(request('bundle-1'), '2026-01-01T00:00:00.000Z')
    store.markReviewBundleRunning('bundle-1', '2026-01-01T00:00:01.000Z')
    store.markReviewAgentRunning(
      'bundle-1',
      'custom-review',
      'provider-session',
      '2026-01-01T00:00:02.000Z',
    )

    const result = store.completeReviewAgent(
      'bundle-1',
      'custom-review',
      'provider-session',
      '2026-01-01T00:00:03.000Z',
      {
        reviewType: 'custom-review',
        verdict: 'PASS',
        findings: [],
      },
      'REVIEWING',
    )

    expect(result).toMatchObject({
      review: { id: 1 },
      agent: {
        status: 'completed',
        reviewId: 1,
      },
    })
    const events = store.readEvents('session-1')
    expect(events.map((event) => event.envelope.type)).toStrictEqual([
      'review-bundle-requested',
      'review-agent-requested',
      'review-bundle-started',
      'review-agent-started',
      'review-recorded',
      'review-agent-completed',
    ])
    expect(events.map((event) => engineEventSchema.parse({
      ...event.envelope,
      ...event.payload,
    }))).toHaveLength(6)
    expect(store.completeReviewBundle(
      'bundle-1',
      '2026-01-01T00:00:04.000Z',
    ).status).toBe('completed')
    store.db.close()
  })

  it('atomically terminates active agents when a bundle fails', () => {
    const store = createStore(databasePath())
    store.claimReviewBundle(request('bundle-1'), '2026-01-01T00:00:00.000Z')
    store.markReviewBundleRunning('bundle-1', '2026-01-01T00:00:01.000Z')
    store.markReviewAgentRunning(
      'bundle-1',
      'custom-review',
      'provider-session',
      '2026-01-01T00:00:02.000Z',
    )

    expect(store.failReviewBundle(
      'bundle-1',
      'Agent failed.',
      '2026-01-01T00:00:03.000Z',
    ).status).toBe('failed')
    expect(store.listReviewAgents('bundle-1')[0]).toMatchObject({
      status: 'failed',
      failureReason: 'Agent failed.',
    })
    expect(store.readEvents('session-1').map(
      (event) => engineEventSchema.parse({
        ...event.envelope,
        ...event.payload,
      }).type,
    )).toContain('review-agent-failed')
    store.db.close()
  })

  it('does not persist a mismatched reviewer completion', () => {
    const store = createStore(databasePath())
    store.claimReviewBundle(request('bundle-1'), '2026-01-01T00:00:00.000Z')

    expect(() => store.completeReviewAgent(
      'bundle-1',
      'custom-review',
      'provider-session',
      '2026-01-01T00:00:01.000Z',
      {
        reviewType: 'different-review',
        verdict: 'PASS',
        findings: [],
      },
      'REVIEWING',
    )).toThrow('does not match custom-review')
    expect(store.listSessionReviews('session-1')).toStrictEqual([])
    expect(store.listReviewAgents('bundle-1')[0]?.status).toBe('requested')
    store.db.close()
  })
})
