import { z } from 'zod'

const reflectionEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('state-period'),
    label: z.string().optional(),
    state: z.string(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
  }),
  z.object({
    kind: z.literal('event'),
    label: z.string().optional(),
    seq: z.number(),
  }),
  z.object({
    kind: z.literal('event-range'),
    label: z.string().optional(),
    startSeq: z.number(),
    endSeq: z.number(),
  }),
  z.object({
    kind: z.literal('journal-entry'),
    label: z.string().optional(),
    at: z.string(),
    agentName: z.string().optional(),
  }),
  z.object({
    kind: z.literal('transcript-range'),
    label: z.string().optional(),
    startIndex: z.number(),
    endIndex: z.number(),
  }),
  z.object({
    kind: z.literal('tool-activity'),
    label: z.string().optional(),
    state: z.string().optional(),
    toolName: z.string().optional(),
    metric: z.string().optional(),
  }),
])

const reflectionFindingSchema = z.object({
  title: z.string(),
  category: z.string(),
  opportunity: z.string(),
  likelyCause: z.string(),
  suggestedChange: z.string(),
  expectedImpact: z.string(),
  confidence: z.string().optional(),
  evidence: z.array(reflectionEvidenceSchema),
})

const reflectionPayloadSchema = z.object({
  summary: z.string().optional(),
  findings: z.array(reflectionFindingSchema),
})

const reflectionSchema = z.object({
  id: z.number(),
  sessionId: z.string(),
  createdAt: z.string(),
  label: z.string().optional(),
  agentName: z.string().optional(),
  sourceState: z.string().optional(),
  reflection: reflectionPayloadSchema,
})

export const reflectionsResponseSchema = z.object({ reflections: z.array(reflectionSchema) })
