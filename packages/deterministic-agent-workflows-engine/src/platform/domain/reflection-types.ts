import { z } from 'zod'

export const reflectionCategorySchema = z.enum([
  'state-efficiency',
  'review-rework',
  'quality-gates',
  'tooling',
  'workflow-design',
])

export const reflectionConfidenceSchema = z.enum(['low', 'medium', 'high'])

const evidenceBaseSchema = z.object({label: z.string().min(1).optional(),})

export const reflectionEvidenceSchema = z.discriminatedUnion('kind', [
  evidenceBaseSchema.extend({
    kind: z.literal('state-period'),
    state: z.string().min(1),
    startedAt: z.string().min(1).optional(),
    endedAt: z.string().min(1).optional(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('event'),
    seq: z.number().int().positive(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('event-range'),
    startSeq: z.number().int().positive(),
    endSeq: z.number().int().positive(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('journal-entry'),
    at: z.string().min(1),
    agentName: z.string().min(1).optional(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('transcript-range'),
    startIndex: z.number().int().nonnegative(),
    endIndex: z.number().int().nonnegative(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('tool-activity'),
    state: z.string().min(1).optional(),
    toolName: z.string().min(1).optional(),
    metric: z.string().min(1).optional(),
  }),
])

export const reflectionFindingSchema = z.object({
  title: z.string().min(1),
  category: reflectionCategorySchema,
  opportunity: z.string().min(1),
  likelyCause: z.string().min(1),
  suggestedChange: z.string().min(1),
  expectedImpact: z.string().min(1),
  confidence: reflectionConfidenceSchema.optional(),
  evidence: z.array(reflectionEvidenceSchema).min(1),
})

export const reflectionPayloadSchema = z.object({
  summary: z.string().min(1).optional(),
  findings: z.array(reflectionFindingSchema).max(10),
}).strict()

export const recordReflectionInputSchema = z.object({
  label: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
  sourceState: z.string().min(1).optional(),
  reflection: reflectionPayloadSchema,
}).strict()

export const storedReflectionSchema = z.object({
  id: z.number().int().positive(),
  sessionId: z.string().min(1),
  createdAt: z.string().min(1),
  label: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
  sourceState: z.string().min(1).optional(),
  reflection: reflectionPayloadSchema,
}).strict()

/** @riviere-role value-object */
export type ReflectionCategory = z.infer<typeof reflectionCategorySchema>

/** @riviere-role value-object */
export type ReflectionEvidence = z.infer<typeof reflectionEvidenceSchema>

/** @riviere-role value-object */
export type ReflectionFinding = z.infer<typeof reflectionFindingSchema>

/** @riviere-role value-object */
export type ReflectionPayload = z.infer<typeof reflectionPayloadSchema>

/** @riviere-role value-object */
export type RecordReflectionInput = z.infer<typeof recordReflectionInputSchema>

/** @riviere-role value-object */
export type StoredReflection = z.infer<typeof storedReflectionSchema>
