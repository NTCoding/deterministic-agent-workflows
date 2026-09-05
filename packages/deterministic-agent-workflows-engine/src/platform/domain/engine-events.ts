import { z } from 'zod'
import { nonEmptyStringSchema } from './non-empty-string'

const sessionStartedSchema = z.object({
  type: z.literal('session-started'),
  at: nonEmptyStringSchema,
  transcriptPath: nonEmptyStringSchema,
  repository: nonEmptyStringSchema,
  currentState: nonEmptyStringSchema,
  states: z.array(nonEmptyStringSchema),
})

const transitionedSchema = z.object({
  type: z.literal('transitioned'),
  at: nonEmptyStringSchema,
  from: nonEmptyStringSchema,
  to: nonEmptyStringSchema,
  preBlockedState: nonEmptyStringSchema.optional(),
  iteration: z.number().optional(),
  developingHeadCommit: nonEmptyStringSchema.optional(),
  developerDone: z.boolean().optional(),
})

const agentRegisteredSchema = z.object({
  type: z.literal('agent-registered'),
  at: nonEmptyStringSchema,
  agentType: nonEmptyStringSchema,
  agentId: nonEmptyStringSchema,
})

const agentShutDownSchema = z.object({
  type: z.literal('agent-shut-down'),
  at: nonEmptyStringSchema,
  agentName: nonEmptyStringSchema,
})

const journalEntrySchema = z.object({
  type: z.literal('journal-entry'),
  at: nonEmptyStringSchema,
  agentName: nonEmptyStringSchema,
  content: nonEmptyStringSchema,
})

const writeCheckedSchema = z.object({
  type: z.literal('write-checked'),
  at: nonEmptyStringSchema,
  tool: nonEmptyStringSchema,
  filePath: nonEmptyStringSchema,
  allowed: z.boolean(),
  reason: nonEmptyStringSchema.optional(),
})

const bashCheckedSchema = z.object({
  type: z.literal('bash-checked'),
  at: nonEmptyStringSchema,
  tool: nonEmptyStringSchema,
  command: nonEmptyStringSchema,
  allowed: z.boolean(),
  reason: nonEmptyStringSchema.optional(),
})

const pluginReadCheckedSchema = z.object({
  type: z.literal('plugin-read-checked'),
  at: nonEmptyStringSchema,
  tool: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  allowed: z.boolean(),
  reason: nonEmptyStringSchema.optional(),
})

const idleCheckedSchema = z.object({
  type: z.literal('idle-checked'),
  at: nonEmptyStringSchema,
  agentName: nonEmptyStringSchema,
  allowed: z.boolean(),
  reason: nonEmptyStringSchema.optional(),
})

const stoppingCheckedSchema = z.object({
  type: z.literal('stopping-checked'),
  at: nonEmptyStringSchema,
  action: z.enum(['stop', 'question']),
  tool: nonEmptyStringSchema.optional(),
  allowed: z.boolean(),
  reason: nonEmptyStringSchema.optional(),
})

const identityVerifiedSchema = z.object({
  type: z.literal('identity-verified'),
  at: nonEmptyStringSchema,
  status: nonEmptyStringSchema,
  transcriptPath: nonEmptyStringSchema,
})

const contextRequestedSchema = z.object({
  type: z.literal('context-requested'),
  at: nonEmptyStringSchema,
  agentName: nonEmptyStringSchema,
})

export const reviewRecordedEventSchema = z.object({
  type: z.literal('review-recorded'),
  at: nonEmptyStringSchema,
  reviewId: z.number().int().positive(),
  reviewType: nonEmptyStringSchema,
  verdict: z.enum(['PASS', 'FAIL']),
})

const reviewBundleRequestedEventSchema = z.object({
  type: z.literal('review-bundle-requested'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  repository: nonEmptyStringSchema,
  pullRequestNumber: z.number().int().positive(),
  headRevision: nonEmptyStringSchema,
})

const reviewBundleStartedEventSchema = z.object({
  type: z.literal('review-bundle-started'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
})

const reviewAgentRequestedEventSchema = z.object({
  type: z.literal('review-agent-requested'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reviewType: nonEmptyStringSchema,
})

const reviewAgentStartedEventSchema = z.object({
  type: z.literal('review-agent-started'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reviewType: nonEmptyStringSchema,
  providerSessionId: nonEmptyStringSchema,
  providerRunId: nonEmptyStringSchema,
})

const reviewAgentCompletedEventSchema = z.object({
  type: z.literal('review-agent-completed'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reviewType: nonEmptyStringSchema,
  providerSessionId: nonEmptyStringSchema,
  providerRunId: nonEmptyStringSchema,
  baseRevision: nonEmptyStringSchema,
  headRevision: nonEmptyStringSchema,
  exactFilesDigest: nonEmptyStringSchema,
  exactFiles: z.array(nonEmptyStringSchema).min(1),
  reviewerDefinitionVersion: nonEmptyStringSchema,
  reviewId: z.number().int().positive(),
  verdict: z.enum(['PASS', 'FAIL']),
})

const reviewAgentFailedEventSchema = z.object({
  type: z.literal('review-agent-failed'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reviewType: nonEmptyStringSchema,
  providerSessionId: nonEmptyStringSchema.optional(),
  reason: nonEmptyStringSchema,
})

const reviewAgentCancelledEventSchema = z.object({
  type: z.literal('review-agent-cancelled'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reviewType: nonEmptyStringSchema,
  providerSessionId: nonEmptyStringSchema.optional(),
  reason: nonEmptyStringSchema,
})

const reviewBundleCompletedEventSchema = z.object({
  type: z.literal('review-bundle-completed'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
})

const reviewBundleFailedEventSchema = z.object({
  type: z.literal('review-bundle-failed'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
})

const reviewBundleCancelledEventSchema = z.object({
  type: z.literal('review-bundle-cancelled'),
  at: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
})

const workflowSessionOwnerTransferredEventSchema = z.object({
  type: z.literal('workflow-session-owner-transferred'),
  at: nonEmptyStringSchema,
  previousOwnerSessionId: nonEmptyStringSchema,
  ownerSessionId: nonEmptyStringSchema,
})

export const engineEventSchema = z.discriminatedUnion('type', [
  sessionStartedSchema,
  transitionedSchema,
  agentRegisteredSchema,
  agentShutDownSchema,
  journalEntrySchema,
  writeCheckedSchema,
  bashCheckedSchema,
  pluginReadCheckedSchema,
  idleCheckedSchema,
  stoppingCheckedSchema,
  identityVerifiedSchema,
  contextRequestedSchema,
  reviewRecordedEventSchema,
  reviewBundleRequestedEventSchema,
  reviewBundleStartedEventSchema,
  reviewAgentRequestedEventSchema,
  reviewAgentStartedEventSchema,
  reviewAgentCompletedEventSchema,
  reviewAgentFailedEventSchema,
  reviewAgentCancelledEventSchema,
  reviewBundleCompletedEventSchema,
  reviewBundleFailedEventSchema,
  reviewBundleCancelledEventSchema,
  workflowSessionOwnerTransferredEventSchema,
])

const platformOwnedEventTypesExcludedFromWorkflowState = new Set<string>([
  'agent-registered',
  'agent-shut-down',
  'journal-entry',
  'write-checked',
  'bash-checked',
  'plugin-read-checked',
  'idle-checked',
  'stopping-checked',
  'identity-verified',
  'context-requested',
  'review-bundle-requested',
  'review-bundle-started',
  'review-agent-requested',
  'review-agent-started',
  'review-agent-completed',
  'review-agent-failed',
  'review-agent-cancelled',
  'review-bundle-completed',
  'review-bundle-failed',
  'review-bundle-cancelled',
])

/** @riviere-role domain-service */
export function isPlatformOwnedEventExcludedFromWorkflowState(type: string): boolean {
  return platformOwnedEventTypesExcludedFromWorkflowState.has(type)
}

/** @riviere-role value-object */
export type EngineEvent = z.infer<typeof engineEventSchema>
/** @riviere-role value-object */
export type SessionStartedEvent = z.infer<typeof sessionStartedSchema>
/** @riviere-role value-object */
export type TransitionedEvent = z.infer<typeof transitionedSchema>
/** @riviere-role value-object */
export type AgentRegisteredEvent = z.infer<typeof agentRegisteredSchema>
/** @riviere-role value-object */
export type AgentShutDownEvent = z.infer<typeof agentShutDownSchema>
/** @riviere-role value-object */
export type JournalEntryEvent = z.infer<typeof journalEntrySchema>
/** @riviere-role value-object */
export type WriteCheckedEvent = z.infer<typeof writeCheckedSchema>
/** @riviere-role value-object */
export type BashCheckedEvent = z.infer<typeof bashCheckedSchema>
/** @riviere-role value-object */
export type PluginReadCheckedEvent = z.infer<typeof pluginReadCheckedSchema>
/** @riviere-role value-object */
export type IdleCheckedEvent = z.infer<typeof idleCheckedSchema>
/** @riviere-role value-object */
export type StoppingCheckedEvent = z.infer<typeof stoppingCheckedSchema>
/** @riviere-role value-object */
export type IdentityVerifiedEvent = z.infer<typeof identityVerifiedSchema>
/** @riviere-role value-object */
export type ContextRequestedEvent = z.infer<typeof contextRequestedSchema>
/** @riviere-role value-object */
export type ReviewRecordedEvent = z.infer<typeof reviewRecordedEventSchema>
/** @riviere-role value-object */
export type ReviewBundleRequestedEvent = z.infer<typeof reviewBundleRequestedEventSchema>
/** @riviere-role value-object */
export type ReviewBundleStartedEvent = z.infer<typeof reviewBundleStartedEventSchema>
/** @riviere-role value-object */
export type ReviewAgentRequestedEvent = z.infer<typeof reviewAgentRequestedEventSchema>
/** @riviere-role value-object */
export type ReviewAgentStartedEvent = z.infer<typeof reviewAgentStartedEventSchema>
/** @riviere-role value-object */
export type ReviewAgentCompletedEvent = z.infer<typeof reviewAgentCompletedEventSchema>
/** @riviere-role value-object */
export type ReviewAgentFailedEvent = z.infer<typeof reviewAgentFailedEventSchema>
/** @riviere-role value-object */
export type ReviewAgentCancelledEvent = z.infer<typeof reviewAgentCancelledEventSchema>
/** @riviere-role value-object */
export type ReviewBundleCompletedEvent = z.infer<typeof reviewBundleCompletedEventSchema>
/** @riviere-role value-object */
export type ReviewBundleFailedEvent = z.infer<typeof reviewBundleFailedEventSchema>
/** @riviere-role value-object */
export type ReviewBundleCancelledEvent = z.infer<typeof reviewBundleCancelledEventSchema>
/** @riviere-role value-object */
export type WorkflowSessionOwnerTransferredEvent = z.infer<typeof workflowSessionOwnerTransferredEventSchema>
