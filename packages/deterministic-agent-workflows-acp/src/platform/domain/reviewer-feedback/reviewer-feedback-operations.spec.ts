import { rmSync } from 'node:fs'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import { ReviewerFeedbackError } from './reviewer-feedback-types'
import type { FixtureGithubServer } from './__fixtures__/reviewer-feedback-github-fixture'
import { startFixtureGithubServer } from './__fixtures__/reviewer-feedback-github-fixture'
import {
  buildFixtureThreads,
  createHarness,
  createService,
  currentWorkspace,
  diffText,
} from './__fixtures__/reviewer-feedback-test-harness'

const testState: { fixture?: FixtureGithubServer } = {}

beforeAll(async () => {
  testState.fixture = await startFixtureGithubServer({
    headRevision: 'head-sha',
    diff: diffText,
    threads: buildFixtureThreads(),
  })
})

afterAll(async () => {
  await testState.fixture?.close()
})

afterEach(() => {
  testState.fixture?.reset()
  const workspace = currentWorkspace()
  if (workspace === undefined) return
  rmSync(workspace, {
    recursive: true,
    force: true,
  })
})

function fixture(): FixtureGithubServer {
  if (testState.fixture === undefined) throw new TypeError('The fixture GitHub server is not started.')
  return testState.fixture
}

describe('reviewer feedback service', () => {
  it('reads the recorded snapshot with open threads and a current head', async () => {
    const { service } = createHarness(fixture())
    const context = await service.readReviewContext()
    expect(context.headStatus).toBe('current')
    expect(context.openThreads).toHaveLength(2)
    expect(context.stateInstructions).toContain('REVIEWING')
  })

  it('submits a review whose messages carry the server-applied prefix', async () => {
    const gh = fixture()
    const { service } = createHarness(gh)
    const result = await service.submitReview({
      event: 'COMMENT',
      body: 'Overall structure looks sound.',
      comments: [{
        path: 'src/engine.ts',
        line: 12,
        side: 'RIGHT',
        body: 'Consider extracting this branch.',
      }],
    })
    const review = gh.state.reviews[0]
    expect(result.status).toBe('submitted')
    expect(review?.body.startsWith('<!-- deterministic-agent-workflow-review:bundle-1:architecture-review -->')).toBe(true)
    expect(review?.body).toContain('[architecture-review] Overall structure looks sound.')
    expect(review?.comments[0]?.body.startsWith('[architecture-review] ')).toBe(true)
  })

  it('rejects comments on paths outside the current diff and records the failure', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    await expect(service.submitReview({
      event: 'COMMENT',
      body: 'Body',
      comments: [{
        path: 'src/unknown.ts',
        line: 1,
        side: 'RIGHT',
        body: 'Comment',
      }],
    })).rejects.toThrow('not part of the current diff')
    expect(store.listFailures(spec.bundleId, spec.reviewType)).toHaveLength(1)
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('validation')
  })

  it('rejects comments on lines outside the current diff hunks', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    await expect(service.submitReview({
      event: 'COMMENT',
      body: 'Body',
      comments: [{
        path: 'src/engine.ts',
        line: 99,
        side: 'RIGHT',
        body: 'Comment',
      }],
    })).rejects.toThrow(ReviewerFeedbackError)
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('validation')
  })

  it('rejects a stale head and records the failure without writing a review', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    fixture().state.headRevision = 'moved-on-sha'
    await expect(service.submitReview({
      event: 'COMMENT',
      body: 'Body',
      comments: [],
    })).rejects.toThrow('fixed to')
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('stale-head')
    expect(fixture().state.reviews).toHaveLength(0)
  })

  it('rejects oversized payloads and records the failure', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    await expect(service.submitReview({
      event: 'COMMENT',
      body: 'x'.repeat(4001),
      comments: [],
    })).rejects.toThrow('limit')
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('bounds')
    expect(fixture().state.reviews).toHaveLength(0)
  })

  it('reconciles a retried submission so no duplicate review is written', async () => {
    const { service } = createHarness(fixture())
    const input = {
      event: 'COMMENT' as const,
      body: 'Body one',
      comments: [],
    }
    const first = await service.submitReview(input)
    const second = await service.submitReview(input)
    const reviewCalls = fixture().requests.filter((request) =>
      request.method === 'POST' && request.path.endsWith('/reviews')).length
    expect([first.status, second.status]).toStrictEqual(['submitted', 'already-recorded'])
    expect(reviewCalls).toBe(1)
    expect(fixture().state.reviews).toHaveLength(1)
  })

  it('reconciles a submission that landed before an indeterminate failure', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    fixture().state.failNextPostWith = 500
    const rejected = {
      event: 'COMMENT' as const,
      body: 'Body',
      comments: [],
    }
    await expect(service.submitReview(rejected)).rejects.toThrow('status 500')
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('indeterminate')
    const reconciled = await service.submitReview(rejected)
    expect(reconciled.status).toBe('submitted')
    expect(fixture().state.reviews).toHaveLength(1)
  })

  it('replies to a thread with the prefix and records thread ownership', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    const reply = await service.replyToThread({
      threadId: 'PRRT_thread-one',
      body: 'Addressed in a follow-up.',
    })
    const ownership = store.listThreadOwnership(spec.bundleId, spec.reviewType)
    const thread = fixture().state.threads.find((candidate) =>
      candidate.id === 'PRRT_thread-one')
    const lastComment = thread?.comments[thread.comments.length - 1]
    expect(reply.status).toBe('replied')
    expect(ownership).toHaveLength(1)
    expect(ownership[0]?.threadId).toBe('PRRT_thread-one')
    expect(lastComment?.body.startsWith('[architecture-review] ')).toBe(true)
  })

  it('fails closed on authentication errors and records the failure', async () => {
    const {
      spec,
      store,
    } = createHarness(fixture())
    const unauthorised = createService(fixture(), spec, store, 'wrong-token')
    await expect(unauthorised.readReviewContext()).rejects.toThrow('401')
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('auth')
  })

  it('fails closed on malformed responses and records the failure', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    fixture().state.malformedJson = true
    await expect(service.readReviewContext()).rejects.toThrow('malformed')
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('malformed')
  })
})

describe('reviewer completion and thread resolution', () => {
  it('records completion with provenance and persists a StoredReview', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    const recorded = await service.recordCompletion({
      verdict: 'PASS',
      satisfaction: 'satisfied',
      summary: 'No blocking findings.',
      findings: [],
    })
    const reviews = store.listSessionReviews(spec.workflowSessionId)
    expect(recorded.status).toBe('recorded')
    expect(store.listReviewAgents(spec.bundleId)[0]?.status).toBe('completed')
    expect(reviews[0]?.completionProvenance?.bundleId).toBe('bundle-1')
    expect(reviews[0]?.reviewType).toBe('architecture-review')
  })

  it('keeps completion idempotent under retry without duplicating reviews', async () => {
    const {
      store,
      service,
    } = createHarness(fixture())
    const input = {
      verdict: 'PASS' as const,
      satisfaction: 'satisfied' as const,
      summary: 'No blocking findings.',
      findings: [],
    }
    const first = await service.recordCompletion(input)
    const second = await service.recordCompletion(input)
    expect([first.status, second.status]).toStrictEqual(['recorded', 'already-recorded'])
    expect(store.listSessionReviews('session-1')).toHaveLength(1)
  })

  it('refuses to resolve threads when workflow policy forbids it', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture(), { threadResolution: 'forbidden' })
    await expect(service.resolveThread({ threadId: 'PRRT_thread-one' })).rejects.toThrow('policy')
    expect(store.listFailures(spec.bundleId, spec.reviewType)[0]?.kind).toBe('policy')
  })

  it('only permits resolving threads owned by this reviewer', async () => {
    const { service } = createHarness(fixture())

    await expect(service.resolveThread({ threadId: 'PRRT_thread-one' })).rejects.toThrow('owned')
    await service.replyToThread({
      threadId: 'PRRT_thread-one',
      body: 'Replying first.',
    })
    expect((await service.resolveThread({ threadId: 'PRRT_thread-one' })).status).toBe('resolved')
    expect(fixture().state.threads.find((candidate) => candidate.id === 'PRRT_thread-one')?.isResolved).toBe(true)
  })

  it('routes a thread to its owning reviewer through queryable records', async () => {
    const {
      spec,
      store,
      service,
    } = createHarness(fixture())
    await service.replyToThread({
      threadId: 'PRRT_thread-two',
      body: 'From architecture.',
    })
    expect(store.findThreadOwner(spec.bundleId, 'PRRT_thread-two')?.reviewType).toBe('architecture-review')
    expect(store.findThreadOwner(spec.bundleId, 'PRRT_thread-one')).toBeUndefined()
  })
})
