import { z } from 'zod'
import { nonEmptyStringSchema } from './non-empty-string'

export const reflectionCategorySchema = z.enum([
  'state-efficiency',
  'review-rework',
  'quality-gates',
  'tooling',
  'workflow-design',
])

export const reflectionConfidenceSchema = z.enum(['low', 'medium', 'high'])

const evidenceBaseSchema = z.object({label: nonEmptyStringSchema.optional(),})

export const reflectionEvidenceSchema = z.discriminatedUnion('kind', [
  evidenceBaseSchema.extend({
    kind: z.literal('state-period'),
    state: nonEmptyStringSchema,
    startedAt: nonEmptyStringSchema.optional(),
    endedAt: nonEmptyStringSchema.optional(),
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
    at: nonEmptyStringSchema,
    agentName: nonEmptyStringSchema.optional(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('transcript-range'),
    startIndex: z.number().int().nonnegative(),
    endIndex: z.number().int().nonnegative(),
  }),
  evidenceBaseSchema.extend({
    kind: z.literal('tool-activity'),
    state: nonEmptyStringSchema.optional(),
    toolName: nonEmptyStringSchema.optional(),
    metric: nonEmptyStringSchema.optional(),
  }),
])

export const reflectionFindingSchema = z.object({
  title: nonEmptyStringSchema,
  category: reflectionCategorySchema,
  opportunity: nonEmptyStringSchema,
  likelyCause: nonEmptyStringSchema,
  suggestedChange: nonEmptyStringSchema,
  expectedImpact: nonEmptyStringSchema,
  confidence: reflectionConfidenceSchema.optional(),
  evidence: z.array(reflectionEvidenceSchema).min(1),
})

export const reflectionPayloadSchema = z.object({
  summary: nonEmptyStringSchema.optional(),
  findings: z.array(reflectionFindingSchema).max(10),
}).strict()

export const recordReflectionInputSchema = z.object({
  label: nonEmptyStringSchema.optional(),
  agentName: nonEmptyStringSchema.optional(),
  sourceState: nonEmptyStringSchema.optional(),
  reflection: reflectionPayloadSchema,
}).strict()

export const storedReflectionSchema = z.object({
  id: z.number().int().positive(),
  sessionId: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  label: nonEmptyStringSchema.optional(),
  agentName: nonEmptyStringSchema.optional(),
  sourceState: nonEmptyStringSchema.optional(),
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
