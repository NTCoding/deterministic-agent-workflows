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
  | {readonly type: 'reviews-completed'}
  | {
    readonly type: 'reviews-failed';
    readonly reason: string
  }

async function collectCompletions(
  started: readonly StartedReview[],
  complete: (review: CompletedReview) => void,
): Promise<CompletionAttempt> {
  try {
    await Promise.all(started.map(async ({
      definition, run
    }) => {
      complete({
        definition,
        run,
        payload: reviewPayloadSchema.parse(await run.completion)
      })
    }))
    return { type: 'reviews-completed' }
  } catch (error) {
    return {
      type: 'reviews-failed',
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
  private readonly cancellations = new Map<string, Promise<ReviewCoordinatorResult>>()
  private readonly executions = new Map<string, Promise<ReviewCoordinatorResult>>()
  private readonly cancellationSignals = new Map<string, (result: ReviewCoordinatorResult) => void>()
  private readonly liveRuns = new Map<string, Map<string, ReviewAgentRun>>()
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
    const running = this.executions.get(input.bundleId)
    if (running !== undefined) return running
    const execution = this.runBundle(input, eventState, existing).finally(() => {
      this.executions.delete(input.bundleId)
      this.liveRuns.delete(input.bundleId)
      this.cancellations.delete(input.bundleId)
      this.cancellationSignals.delete(input.bundleId)
    })
    this.executions.set(input.bundleId, execution)
    return execution
  }

  private async runBundle(
    input: ReviewBundleRequest,
    eventState: string,
    existing: StoredReviewBundle | undefined,
  ): Promise<ReviewCoordinatorResult> {
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
    const cancelled = new Promise<ReviewCoordinatorResult>((resolve) => {
      this.cancellationSignals.set(bundle.bundleId, resolve)
    })
    const liveRuns = new Map<string, ReviewAgentRun>()
    this.liveRuns.set(bundle.bundleId, liveRuns)
    const startPromises = pendingDefinitions.map(async (definition) => {
      const stored = storedAgents.get(definition.reviewType)
      const request = buildAgentRequest(input, definition)
      const run = stored?.providerSessionId === undefined
        ? await this.client.start(request)
        : await this.client.load(request, stored.providerSessionId)
      liveRuns.set(definition.reviewType, run)
      // Observe failures immediately while the other provider starts are still pending.
      // The original completion promise is still validated by collectCompletions.
      void run.completion.catch(() => undefined)
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
    const cancellation = this.cancellations.get(bundle.bundleId)
    if (cancellation !== undefined) return cancellation
    const startFailure = starts.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (startFailure !== undefined) {
      return this.failBundle(bundle.bundleId, `Unable to start review bundle: ${String(startFailure.reason)}`)
    }

    const completionAttempt = await Promise.race([
      collectCompletions(started, (review) => this.completeReview(input, eventState, review)),
      cancelled,
    ])
    if (completionAttempt.type !== 'reviews-completed' && completionAttempt.type !== 'reviews-failed') {
      return completionAttempt
    }
    const pendingCancellation = this.cancellations.get(bundle.bundleId)
    if (pendingCancellation !== undefined) return pendingCancellation
    const latestTerminal = terminalResult(this.store.getReviewBundle(bundle.bundleId))
    if (latestTerminal !== undefined) return latestTerminal
    if (completionAttempt.type === 'reviews-failed') {
      return this.failBundle(bundle.bundleId, completionAttempt.reason)
    }

    return {
      type: 'completed',
      bundle: this.store.completeReviewBundle(bundle.bundleId, this.now()),
    }
  }

  private completeReview(input: ReviewBundleRequest, eventState: string, review: CompletedReview): void {
    if (!this.executions.has(input.bundleId) || this.cancellations.has(input.bundleId) ||
      terminalResult(this.store.getReviewBundle(input.bundleId)) !== undefined) return
    const {
      definition, run, payload
    } = review
    this.store.completeReviewAgent(
      input.bundleId,
      definition.reviewType,
      {
        bundleId: input.bundleId,
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

  async cancel(bundleId: string, reason: string): Promise<ReviewCoordinatorResult> {
    const existing = this.cancellations.get(bundleId)
    if (existing !== undefined) return existing
    const cancellation = this.cancelBundle(bundleId, reason).then((result) => {
      this.cancellationSignals.get(bundleId)?.(result)
      return result
    })
    this.cancellations.set(bundleId, cancellation)
    return cancellation
  }

  private async stopAgents(bundleId: string): Promise<readonly string[]> {
    const live = this.liveRuns.get(bundleId)
    const agents = this.store.listReviewAgents(bundleId).filter(
      (agent) => agent.status === 'running',
    )
    const results = await Promise.allSettled(agents.map(async (agent) => {
      const run = live?.get(agent.reviewType)
      if (run !== undefined) return run.cancel()
      if (agent.providerSessionId === undefined || agent.providerRunId === undefined) {
        throw new WorkflowStateError(`Running review agent ${agent.reviewType} has no provider identity.`)
      }
      return this.client.cancel(agent.providerSessionId, agent.providerRunId)
    }))
    return results.flatMap((result) => result.status === 'rejected' ? [String(result.reason)] : [])
  }

  private async failBundle(bundleId: string, reason: string): Promise<ReviewCoordinatorResult> {
    const errors = await this.stopAgents(bundleId)
    const failureReason = errors.length === 0 ? reason : `${reason}; Cancellation failed: ${errors.join('; ')}`
    const terminal = terminalResult(this.store.getReviewBundle(bundleId))
    if (terminal !== undefined) return terminal
    return {
      type: 'failed',
      reason: failureReason,
      bundle: this.store.failReviewBundle(bundleId, failureReason, this.now()),
    }
  }

  private async cancelBundle(bundleId: string, reason: string): Promise<ReviewCoordinatorResult> {
    const initial = this.store.getReviewBundle(bundleId)
    if (initial === undefined) throw new WorkflowStateError(`Review bundle ${bundleId} not found.`)
    const initialTerminal = terminalResult(initial)
    if (initialTerminal !== undefined) return initialTerminal
    await this.startBarriers.get(bundleId)
    const errors = await this.stopAgents(bundleId)
    const terminal = terminalResult(this.store.getReviewBundle(bundleId))
    if (terminal !== undefined) return terminal
    if (errors.length > 0) {
      const failureReason = `Cancellation failed: ${errors.join('; ')}`
      return {
        type: 'failed',
        reason: failureReason,
        bundle: this.store.failReviewBundle(bundleId, failureReason, this.now()),
      }
    }
    return {
      type: 'cancelled',
      bundle: this.store.cancelReviewBundle(bundleId, reason, this.now()),
    }
  }
}
