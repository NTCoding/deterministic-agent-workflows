import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SqliteEventStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { createGithubApiClient } from '../../../infra/external-clients/github/github-api-client'
import { createReviewerFeedbackService } from '../reviewer-feedback-operations'
import {
  reviewerFeedbackServerSpecSchema,
  type ReviewerFeedbackServerSpec,
} from '../reviewer-feedback-types'
import type {
  FixtureGithubServer,
  FixtureThread,
} from './reviewer-feedback-github-fixture'

export const reviewTypes = ['architecture-review', 'code-review', 'bug-scanner', 'task-check'] as const

export const diffText = [
  'diff --git a/src/engine.ts b/src/engine.ts',
  'index 111..222 100644',
  '--- a/src/engine.ts',
  '+++ b/src/engine.ts',
  '@@ -10,4 +10,5 @@ existing context',
  ' context line',
  'removed line',
  'added line one',
  'added line two',
  'diff --git a/src/removed-file.ts b/src/removed-file.ts',
  'index 333..000 100644',
  '--- a/src/removed-file.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  'old line one',
  'old line two',
].join('\n')

export function buildFixtureThreads(): FixtureThread[] {
  return [
    {
      id: 'PRRT_thread-one',
      isResolved: false,
      comments: [{
        databaseId: 501,
        authorLogin: 'human-reviewer',
        body: 'Please look at engine.ts',
      }],
    },
    {
      id: 'PRRT_thread-two',
      isResolved: false,
      comments: [{
        databaseId: 502,
        authorLogin: 'human-reviewer',
        body: 'Old question',
      }],
    },
  ]
}

const workspaceHolder: { workspace?: string } = {}

export function currentWorkspace(): string | undefined {
  return workspaceHolder.workspace
}

function requireWorkspace(): string {
  if (workspaceHolder.workspace === undefined) throw new TypeError('Harness workspace is not initialised.')
  return workspaceHolder.workspace
}

export function buildSpec(overrides?: Partial<ReviewerFeedbackServerSpec>): ReviewerFeedbackServerSpec {
  return reviewerFeedbackServerSpecSchema.parse({
    repository: 'example-repo/example-project',
    pullRequestNumber: 42,
    bundleId: 'bundle-1',
    workflowSessionId: 'session-1',
    reviewType: 'architecture-review',
    sourceState: 'REVIEWING',
    expectedHeadRevision: 'head-sha',
    threadResolution: 'owned-threads',
    bounds: {},
    databasePath: join(requireWorkspace(), 'workflow.db'),
    ...overrides,
  })
}

export function seedBundle(
  store: SqliteEventStore,
  spec: ReviewerFeedbackServerSpec,
  reviewers: readonly string[],
): void {
  store.claimReviewBundle({
    bundleId: spec.bundleId,
    sessionId: spec.workflowSessionId,
    repository: spec.repository,
    workingDirectory: requireWorkspace(),
    pullRequestNumber: spec.pullRequestNumber,
    baseRevision: 'base-sha',
    headRevision: spec.expectedHeadRevision,
    changedFiles: ['src/engine.ts', 'src/removed-file.ts'],
    stateInstructions: 'You are in REVIEWING. Read the threads and publish your review.',
    reviews: reviewers.map((reviewType) => ({
      reviewType,
      instructions: `Review the change as ${reviewType}.`,
      version: '1',
    })),
  }, '2026-01-01T00:00:00.000Z')
  store.markReviewBundleRunning(spec.bundleId, '2026-01-01T00:00:01.000Z')
  for (const [index, reviewType] of reviewers.entries()) {
    store.markReviewAgentRunning(
      spec.bundleId,
      reviewType,
      `provider-session-${reviewType}`,
      `provider-run-${reviewType}-${String(index)}`,
      '2026-01-01T00:00:02.000Z',
    )
  }
}

/** @riviere-role value-object */
export interface Harness {
  readonly spec: ReviewerFeedbackServerSpec
  readonly store: SqliteEventStore
  readonly service: ReturnType<typeof createService>
}

export function createHarness(
  fixture: FixtureGithubServer,
  overrides?: Partial<ReviewerFeedbackServerSpec>,
  reviewers: readonly string[] = [],
): Harness {
  workspaceHolder.workspace = mkdtempSync(join(tmpdir(), 'daw-reviewer-feedback-spec-'))
  workspaceHolder.workspace = mkdtempSync(join(tmpdir(), 'daw-reviewer-feedback-spec-'))
  const spec = buildSpec(overrides)
  const store = createStore(spec.databasePath)
  seedBundle(store, spec, reviewers.length === 0 ? [spec.reviewType] : reviewers)
  return {
    spec,
    store,
    service: createService(fixture, spec, store),
  }
}

export function createService(
  fixture: FixtureGithubServer,
  spec: ReviewerFeedbackServerSpec,
  store: SqliteEventStore,
  token = 'fixture-token',
) {
  return createReviewerFeedbackService({
    spec,
    github: createGithubApiClient({
      token,
      repository: spec.repository,
      pullRequestNumber: spec.pullRequestNumber,
      restApiBaseUrl: fixture.restBaseUrl,
      graphqlApiBaseUrl: fixture.graphqlBaseUrl,
    }),
    reviewJobStore: store,
    feedbackStore: store,
    now: () => '2026-01-01T00:03:00.000Z',
  })
}
