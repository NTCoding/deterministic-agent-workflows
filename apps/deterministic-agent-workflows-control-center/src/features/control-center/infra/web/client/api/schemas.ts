import { z } from 'zod'

const permissionDenialsSchema = z.object({
  write: z.number(),
  bash: z.number(),
  pluginRead: z.number(),
  idle: z.number(),
})

/** @riviere-role web-tbc */
export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  currentState: z.string(),
  workflowStates: z.array(z.string()),
  status: z.string(),
  totalEvents: z.number(),
  firstEventAt: z.string(),
  lastEventAt: z.string(),
  durationMs: z.number(),
  activeAgents: z.array(z.string()),
  transitionCount: z.number(),
  permissionDenials: permissionDenialsSchema,
  repository: z.string().optional(),
  issueNumber: z.number().optional(),
  featureBranch: z.string().optional(),
  prNumber: z.number().optional(),
})

/** @riviere-role web-tbc */
export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  total: z.number(),
})

/** @riviere-role web-tbc */
export const sessionDetailResponseSchema = sessionSummarySchema.extend({
  journalEntries: z.array(z.unknown()),
  insights: z.array(z.unknown()),
  suggestions: z.array(z.unknown()),
  statePeriods: z.array(z.unknown()),
})

const annotatedEventSchema = z.object({
  seq: z.number(),
  sessionId: z.string(),
  type: z.string(),
  recordedAt: z.string(),
  payload: z.record(z.unknown()),
  state: z.string().optional(),
  category: z.string().optional(),
  detail: z.string().optional(),
  denied: z.boolean().optional(),
})

/** @riviere-role web-tbc */
export const sessionEventsResponseSchema = z.object({
  events: z.array(annotatedEventSchema),
  total: z.number(),
})

const reflectionFindingSchema = z.object({
  type: z.string(),
  description: z.string(),
}).passthrough()

const reflectionEntrySchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  reflection: z.object({findings: z.array(reflectionFindingSchema),}).passthrough(),
}).passthrough()

/** @riviere-role web-tbc */
export const sessionReflectionsResponseSchema = z.object({reflections: z.array(reflectionEntrySchema),})

/** @riviere-role web-tbc */
export type SessionSummary = z.infer<typeof sessionSummarySchema>
/** @riviere-role web-tbc */
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>
/** @riviere-role web-tbc */
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>
/** @riviere-role web-tbc */
export type AnnotatedEvent = z.infer<typeof annotatedEventSchema>
/** @riviere-role web-tbc */
export type SessionEventsResponse = z.infer<typeof sessionEventsResponseSchema>
/** @riviere-role web-tbc */
export type ReflectionEntry = z.infer<typeof reflectionEntrySchema>
/** @riviere-role web-tbc */
export type SessionReflectionsResponse = z.infer<typeof sessionReflectionsResponseSchema>
