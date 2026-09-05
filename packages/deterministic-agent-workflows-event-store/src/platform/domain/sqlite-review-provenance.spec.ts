import { createHash } from 'node:crypto'
import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterEach, describe, expect, it
} from 'vitest'
import {
  storedReviewSchema,
  type ReviewCompletionProvenance,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createStore } from './sqlite-event-store'

const directories: string[] = []
const timestamp = '2026-01-01T00:00:00.000Z'
const exactFiles = ['src/second.ts', 'src/first.ts']
const provenance: ReviewCompletionProvenance = {
  bundleId: 'bundle',
  providerSessionId: 'provider-session',
  providerRunId: 'provider-run',
  baseRevision: 'base',
  headRevision: 'head',
  exactFiles,
  exactFilesDigest: createHash('sha256').update(JSON.stringify(exactFiles)).digest('hex'),
  reviewerDefinitionVersion: 'v1',
}
const reviewInput = {
  reviewType: 'custom-review',
  verdict: 'PASS' as const,
  findings: [],
}

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'review-provenance-'))
  directories.push(directory)
  return join(directory, 'events.db')
}

function completeReview(store: ReturnType<typeof createStore>) {
  store.claimReviewBundle({
    bundleId: provenance.bundleId,
    sessionId: 'workflow-session',
    repository: 'owner/repository',
    workingDirectory: '/repository',
    pullRequestNumber: 42,
    baseRevision: provenance.baseRevision,
    headRevision: provenance.headRevision,
    changedFiles: exactFiles,
    stateInstructions: 'Review the recorded change.',
    reviews: [{
      reviewType: reviewInput.reviewType,
      instructions: 'Inspect correctness.',
      version: provenance.reviewerDefinitionVersion,
    }],
  }, timestamp)
  store.markReviewBundleRunning(provenance.bundleId, timestamp)
  store.markReviewAgentRunning(
    provenance.bundleId,
    reviewInput.reviewType,
    provenance.providerSessionId,
    provenance.providerRunId,
    timestamp,
  )
  return store.completeReviewAgent(
    provenance.bundleId,
    reviewInput.reviewType,
    provenance,
    timestamp,
    reviewInput,
    'REVIEWING',
  )
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

describe('public stored review provenance', () => {
  it('returns exact provenance from completion and both query APIs after reopening', () => {
    const path = databasePath()
    const store = createStore(path)
    const completed = completeReview(store)
    store.db.close()
    const reopened = createStore(path)
    try {
      expect(completed.review.completionProvenance).toStrictEqual(provenance)
      expect(reopened.listSessionReviews('workflow-session')).toStrictEqual([completed.review])
      expect(reopened.listReviews({})).toStrictEqual([completed.review])
    } finally {
      reopened.db.close()
    }
  })

  it('retains legacy reviews without inventing provenance', () => {
    const store = createStore(databasePath())
    try {
      const legacy = store.recordReview('workflow-session', timestamp, reviewInput)
      expect(legacy).not.toHaveProperty('completionProvenance')
      expect(store.listSessionReviews('workflow-session')).toStrictEqual([legacy])
      expect(store.listReviews({})).toStrictEqual([legacy])
    } finally {
      store.db.close()
    }
  })

  it('rejects malformed provenance in both persisted query paths', () => {
    const store = createStore(databasePath())
    try {
      completeReview(store)
      store.db.prepare('UPDATE reviews SET payload_json = ?').run(JSON.stringify({
        ...reviewInput,
        completionProvenance: {
          ...provenance,
          providerRunId: '',
        },
      }))
      expect(() => store.listSessionReviews('workflow-session')).toThrow('String must contain at least 1 character')
      expect(() => store.listReviews({})).toThrow('String must contain at least 1 character')
    } finally {
      store.db.close()
    }
  })

  it('rejects incomplete provenance in the public stored result schema', () => {
    expect(() => storedReviewSchema.parse({
      ...reviewInput,
      id: 1,
      sessionId: 'workflow-session',
      createdAt: timestamp,
      completionProvenance: { bundleId: provenance.bundleId },
    })).toThrow('Required')
  })
})
