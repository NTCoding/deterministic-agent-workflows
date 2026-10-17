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
  identityVerifiedSchema,
  contextRequestedSchema,
  reviewRecordedEventSchema,
])

const platformOwnedEventTypesExcludedFromWorkflowState = new Set<string>([
  'agent-registered',
  'agent-shut-down',
  'journal-entry',
  'write-checked',
  'bash-checked',
  'plugin-read-checked',
  'idle-checked',
  'identity-verified',
  'context-requested',
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
export type IdentityVerifiedEvent = z.infer<typeof identityVerifiedSchema>
/** @riviere-role value-object */
export type ContextRequestedEvent = z.infer<typeof contextRequestedSchema>
/** @riviere-role value-object */
export type ReviewRecordedEvent = z.infer<typeof reviewRecordedEventSchema>
