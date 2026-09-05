import { createHash } from 'node:crypto'
import {
  recordReviewInputSchema,
  reviewBundleRequestSchema,
  reviewPayloadSchema,
  WorkflowStateError,
  type ReviewBundleRequest,
  type ReviewDefinition,
  type ReviewJobStore,
  type ReviewPayload,
  type StoredReviewBundle,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'

/** @riviere-role value-object */
export interface ReviewAgentRequest {
  readonly bundleId: string
  readonly reviewType: string
  readonly repository: string
  readonly workingDirectory: string
  readonly pullRequestNumber: number
  readonly baseRevision: string
  readonly headRevision: string
  readonly prompt: string
}

/** @riviere-role value-object */
export interface ReviewAgentRun {
  readonly providerSessionId: string
  readonly providerRunId: string
  readonly completion: Promise<ReviewPayload>
  cancel(): Promise<void>
}

/** @riviere-role value-object */
export interface ReviewAgentClient {
  start(input: ReviewAgentRequest): Promise<ReviewAgentRun>
  load(input: ReviewAgentRequest, providerSessionId: string): Promise<ReviewAgentRun>
  cancel(providerSessionId: string, providerRunId: string): Promise<void>
}

/** @riviere-role value-object */
export type ReviewCoordinatorResult =
  | {
    readonly type: 'completed'
    readonly bundle: StoredReviewBundle
  }
  | {
    readonly type: 'failed'
    readonly bundle: StoredReviewBundle
    readonly reason: string
  }
  | {
    readonly type: 'cancelled'
    readonly bundle: StoredReviewBundle
  }

/** @riviere-role value-object */
export interface ReviewCoordinatorDeps {
  readonly store: ReviewJobStore
  readonly client: ReviewAgentClient
  readonly now: () => string
}

function buildReviewPrompt(
  input: ReviewBundleRequest,
  definition: ReviewDefinition,
): string {
  const files = input.changedFiles.map((file) => `- ${file}`).join('\n')
  return [
    definition.instructions,
    '',
    input.stateInstructions,
    '',
    'Publish review feedback through the constrained tools provided to you.',
    'Then return exactly one JSON object and no Markdown with this shape:',
    '{"verdict":"PASS|FAIL","summary":"optional","findings":[{"title":"optional","severity":"minor|major|critical","status":"blocking|non-blocking|accepted-risk","rule":"optional","file":"optional","startLine":1,"endLine":1,"details":"optional","recommendation":"optional"}]}',
    'Every finding must include at least one of title, details, or rule. Omit optional properties you do not use.',
    '',
    `Repository: ${input.repository}`,
    `Pull Request: ${String(input.pullRequestNumber)}`,
    `Base Revision: ${input.baseRevision}`,
    `Head Revision: ${input.headRevision}`,
    '',
    'Files to Review:',
    files,
  ].join('\n')
}

function hasSameReviewRequest(
  stored: StoredReviewBundle,
  input: ReviewBundleRequest,
): boolean {
  return stored.bundleId === input.bundleId &&
    stored.sessionId === input.sessionId &&
    stored.repository === input.repository &&
    stored.workingDirectory === input.workingDirectory &&
    stored.pullRequestNumber === input.pullRequestNumber &&
    stored.baseRevision === input.baseRevision &&
    stored.headRevision === input.headRevision &&
    stored.stateInstructions === input.stateInstructions &&
    JSON.stringify(stored.changedFiles) === JSON.stringify(input.changedFiles) &&
    JSON.stringify(stored.reviews) === JSON.stringify(input.reviews)
}

function terminalResult(
  bundle: StoredReviewBundle | undefined,
): ReviewCoordinatorResult | undefined {
  if (bundle?.status === 'completed') return {
    type: 'completed',
    bundle
  }
  if (bundle?.status === 'cancelled') return {
    type: 'cancelled',
    bundle
  }
  if (bundle?.status === 'failed') return {
    type: 'failed',
    bundle,
    reason: bundle.failureReason ?? 'Review bundle failed.',
  }
  return undefined
}

function claimOrResumeBundle(
  store: ReviewJobStore,
  input: ReviewBundleRequest,
  existing: StoredReviewBundle | undefined,
  now: () => string,
): StoredReviewBundle {
  if (existing !== undefined) return existing
  const active = store.findActiveReviewBundle(input.repository, input.pullRequestNumber)
  if (active !== undefined) {
    throw new WorkflowStateError(
      `Pull request ${input.repository}#${String(input.pullRequestNumber)} already has active review bundle ${active.bundleId}.`,
    )
  }
  return store.claimReviewBundle(input, now())
}

type StartedReview = {
  readonly definition: ReviewDefinition
  readonly run: ReviewAgentRun
}

type CompletedReview = StartedReview & {readonly payload: ReviewPayload}

type CompletionAttempt =
  | {
    readonly ok: true;
    readonly completions: readonly CompletedReview[]
  }
  | {
    readonly ok: false;
    readonly reason: string
  }

async function collectCompletions(started: readonly StartedReview[]): Promise<CompletionAttempt> {
  try {
    const completions = await Promise.all(started.map(async ({
      definition, run
    }) => ({
      definition,
      run,
      payload: reviewPayloadSchema.parse(await run.completion),
    })))
    return {
      ok: true,
      completions
    }
  } catch (error) {
    await Promise.allSettled(started.map(({ run }) => run.cancel()))
    return {
      ok: false,
      reason: `Review agent failed: ${String(error)}`
    }
  }
}

function exactFilesDigest(files: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

function buildAgentRequest(
  input: ReviewBundleRequest,
  definition: ReviewDefinition,
): ReviewAgentRequest {
  return {
    bundleId: input.bundleId,
    reviewType: definition.reviewType,
    repository: input.repository,
    workingDirectory: input.workingDirectory,
    pullRequestNumber: input.pullRequestNumber,
    baseRevision: input.baseRevision,
    headRevision: input.headRevision,
    prompt: buildReviewPrompt(input, definition),
  }
}

/** @riviere-role domain-service */
export class ReviewCoordinator {
  private readonly store: ReviewJobStore
  private readonly client: ReviewAgentClient
  private readonly now: () => string
  private readonly cancellationReasons = new Map<string, string>()
  private readonly startBarriers = new Map<string, Promise<void>>()

  constructor(deps: ReviewCoordinatorDeps) {
    this.store = deps.store
    this.client = deps.client
    this.now = deps.now
  }

  async run(rawInput: ReviewBundleRequest, eventState: string): Promise<ReviewCoordinatorResult> {
    const input = reviewBundleRequestSchema.parse(rawInput)
    const existing = this.store.getReviewBundle(input.bundleId)
    if (existing !== undefined && !hasSameReviewRequest(existing, input)) {
      throw new WorkflowStateError(
        `Review bundle ${input.bundleId} cannot be resumed with different inputs.`,
      )
    }
    const terminal = terminalResult(existing)
    if (terminal !== undefined) return terminal
    const claimed = claimOrResumeBundle(this.store, input, existing, this.now)
    const bundle = claimed.status === 'requested'
      ? this.store.markReviewBundleRunning(claimed.bundleId, this.now())
      : claimed

    const storedAgents = new Map(
      this.store.listReviewAgents(bundle.bundleId).map((agent) => [agent.reviewType, agent]),
    )
    const pendingDefinitions = input.reviews.filter(
      (definition) => storedAgents.get(definition.reviewType)?.status !== 'completed',
    )
    const startPromises = pendingDefinitions.map(async (definition) => {
      const stored = storedAgents.get(definition.reviewType)
      const request = buildAgentRequest(input, definition)
      const run = stored?.providerSessionId === undefined
        ? await this.client.start(request)
        : await this.client.load(request, stored.providerSessionId)
      try {
        if (stored?.status === 'running') {
          this.store.resumeReviewAgent(
            bundle.bundleId,
            definition.reviewType,
            run.providerSessionId,
            run.providerRunId,
            this.now(),
          )
        } else {
          this.store.markReviewAgentRunning(
            bundle.bundleId,
            definition.reviewType,
            run.providerSessionId,
            run.providerRunId,
            this.now(),
          )
        }
      } catch (error) {
        await run.cancel()
        throw error
      }
      if (this.cancellationReasons.has(bundle.bundleId)) await run.cancel()
      return {
        definition,
        run
      }
    })
    const startBarrier = Promise.allSettled(startPromises).then(() => undefined)
    this.startBarriers.set(bundle.bundleId, startBarrier)
    const starts = await Promise.allSettled(startPromises)
    this.startBarriers.delete(bundle.bundleId)
    const started = starts.flatMap(
      (result) => result.status === 'fulfilled' ? [result.value] : [],
    )
    const cancellationReason = this.cancellationReasons.get(bundle.bundleId)
    if (cancellationReason !== undefined) {
      this.cancellationReasons.delete(bundle.bundleId)
      const current = this.store.getReviewBundle(bundle.bundleId)
      return {
        type: 'cancelled',
        bundle: current?.status === 'cancelled'
          ? current
          : this.store.cancelReviewBundle(bundle.bundleId, cancellationReason, this.now()),
      }
    }
    const startFailure = starts.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (startFailure !== undefined) {
      await Promise.allSettled(started.map(({ run }) => run.cancel()))
      const reason = `Unable to start review bundle: ${String(startFailure.reason)}`
      return {
        type: 'failed',
        reason,
        bundle: this.store.failReviewBundle(bundle.bundleId, reason, this.now()),
      }
    }

    const completionAttempt = await collectCompletions(started)
    if (!completionAttempt.ok) return {
      type: 'failed',
      reason: completionAttempt.reason,
      bundle: this.store.failReviewBundle(
        bundle.bundleId,
        completionAttempt.reason,
        this.now(),
      ),
    }

    for (const {
      definition, run, payload
    } of completionAttempt.completions) {
      this.store.completeReviewAgent(
        bundle.bundleId,
        definition.reviewType,
        {
          bundleId: bundle.bundleId,
          providerSessionId: run.providerSessionId,
          providerRunId: run.providerRunId,
          baseRevision: input.baseRevision,
          headRevision: input.headRevision,
          exactFilesDigest: exactFilesDigest(input.changedFiles),
          exactFiles: input.changedFiles,
          reviewerDefinitionVersion: definition.version,
        },
        this.now(),
        recordReviewInputSchema.parse({
          ...payload,
          reviewType: definition.reviewType,
          pullRequestNumber: input.pullRequestNumber,
          sourceState: eventState,
        }),
        eventState,
      )
    }

    return {
      type: 'completed',
      bundle: this.store.completeReviewBundle(bundle.bundleId, this.now()),
    }
  }

  async cancel(bundleId: string, reason: string): Promise<ReviewCoordinatorResult> {
    const initial = this.store.getReviewBundle(bundleId)
    if (initial === undefined) {
      throw new WorkflowStateError(`Review bundle ${bundleId} not found.`)
    }
    const initialTerminal = terminalResult(initial)
    if (initialTerminal !== undefined) return initialTerminal
    this.cancellationReasons.set(bundleId, reason)
    const startBarrier = this.startBarriers.get(bundleId)
    await startBarrier
    const bundle = this.store.getReviewBundle(bundleId)
    const terminal = terminalResult(bundle)
    if (terminal !== undefined) {
      if (startBarrier === undefined) this.cancellationReasons.delete(bundleId)
      return terminal
    }
    const activeRuns = this.store.listReviewAgents(bundleId).flatMap(
      (agent) => agent.status === 'running' && agent.providerSessionId !== undefined &&
        agent.providerRunId !== undefined
        ? [{
          providerSessionId: agent.providerSessionId,
          providerRunId: agent.providerRunId,
        }]
        : [],
    )
    await Promise.allSettled(activeRuns.map((run) =>
      this.client.cancel(run.providerSessionId, run.providerRunId)))
    const latest = this.store.getReviewBundle(bundleId)
    const latestTerminal = terminalResult(latest)
    if (latestTerminal !== undefined) {
      if (startBarrier === undefined) this.cancellationReasons.delete(bundleId)
      return latestTerminal
    }
    const cancelled = this.store.cancelReviewBundle(bundleId, reason, this.now())
    if (startBarrier === undefined) this.cancellationReasons.delete(bundleId)
    return {
      type: 'cancelled',
      bundle: cancelled,
    }
  }
}
