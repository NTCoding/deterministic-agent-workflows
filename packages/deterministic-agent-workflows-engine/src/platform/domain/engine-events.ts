import { z } from 'zod'

const sessionStartedSchema = z.object({
  type: z.literal('session-started'),
  at: z.string(),
  transcriptPath: z.string().optional(),
  repository: z.string().optional(),
  currentState: z.string().optional(),
  states: z.array(z.string()).optional(),
})

const transitionedSchema = z.object({
  type: z.literal('transitioned'),
  at: z.string(),
  from: z.string(),
  to: z.string(),
  preBlockedState: z.string().optional(),
  iteration: z.number().optional(),
  developingHeadCommit: z.string().optional(),
  developerDone: z.boolean().optional(),
})

const agentRegisteredSchema = z.object({
  type: z.literal('agent-registered'),
  at: z.string(),
  agentType: z.string(),
  agentId: z.string(),
})

const agentShutDownSchema = z.object({
  type: z.literal('agent-shut-down'),
  at: z.string(),
  agentName: z.string(),
})

const journalEntrySchema = z.object({
  type: z.literal('journal-entry'),
  at: z.string(),
  agentName: z.string(),
  content: z.string(),
})

const writeCheckedSchema = z.object({
  type: z.literal('write-checked'),
  at: z.string(),
  tool: z.string(),
  filePath: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
})

const bashCheckedSchema = z.object({
  type: z.literal('bash-checked'),
  at: z.string(),
  tool: z.string(),
  command: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
})

const pluginReadCheckedSchema = z.object({
  type: z.literal('plugin-read-checked'),
  at: z.string(),
  tool: z.string(),
  path: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
})

const idleCheckedSchema = z.object({
  type: z.literal('idle-checked'),
  at: z.string(),
  agentName: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
})

const identityVerifiedSchema = z.object({
  type: z.literal('identity-verified'),
  at: z.string(),
  status: z.string(),
  transcriptPath: z.string(),
})

const contextRequestedSchema = z.object({
  type: z.literal('context-requested'),
  at: z.string(),
  agentName: z.string(),
})

const reviewRecordedSchema = z.object({
  type: z.literal('review-recorded'),
  at: z.string(),
  reviewId: z.number().int().positive(),
  reviewType: z.string(),
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
  reviewRecordedSchema,
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
  'review-recorded',
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
export type ReviewRecordedEvent = z.infer<typeof reviewRecordedSchema>
