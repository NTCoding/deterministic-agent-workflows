import { rmSync } from 'node:fs'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import type { FixtureGithubServer } from './__fixtures__/reviewer-feedback-github-fixture'
import { startFixtureGithubServer } from './__fixtures__/reviewer-feedback-github-fixture'
import {
  buildFixtureThreads,
  buildSpec,
  createHarness,
  createService,
  currentWorkspace,
  diffText,
  reviewTypes,
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

describe('four concurrent fixture reviewers', () => {
  it('completes a full feedback cycle per reviewer with no duplicated GitHub writes', async () => {
    const {
      spec,
      store,
    } = createHarness(fixture(), undefined, reviewTypes)
    const services = reviewTypes.map((reviewType) =>
      createService(fixture(), buildSpec({ reviewType }), store))
    const submitted = await Promise.all(services.map((service, index) => service.submitReview({
      event: 'COMMENT',
      body: `Findings from reviewer ${String(index)}.`,
      comments: [{
        path: 'src/engine.ts',
        line: 13,
        side: 'RIGHT',
        body: `Note ${String(index)}.`,
      }],
    })))
    const completion = {
      verdict: 'PASS' as const,
      satisfaction: 'satisfied' as const,
      summary: 'Done.',
      findings: [],
    }
    await Promise.all(services.map((service) => service.recordCompletion(completion)))
    expect(submitted.map((result) => result.status))
      .toStrictEqual(['submitted', 'submitted', 'submitted', 'submitted'])
    expect(fixture().state.reviews).toHaveLength(4)
    expect(store.listThreadOwnership(spec.bundleId)).toHaveLength(4)
    expect(store.completeReviewBundle(spec.bundleId, '2026-01-01T00:09:00.000Z').status).toBe('completed')
  })
})
