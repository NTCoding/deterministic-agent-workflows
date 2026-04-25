import { z } from 'zod'

const reviewFindingSchema = z.object({
  title: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  rule: z.string().optional(),
  file: z.string().optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  details: z.string().optional(),
  recommendation: z.string().optional(),
})

const reviewSchema = z.object({
  id: z.number(),
  sessionId: z.string(),
  createdAt: z.string(),
  reviewType: z.string(),
  verdict: z.enum(['PASS', 'FAIL']),
  repository: z.string().optional(),
  branch: z.string().optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  sourceState: z.string().optional(),
  summary: z.string().optional(),
  findings: z.array(reviewFindingSchema),
})

export const reviewsResponseSchema = z.object({ reviews: z.array(reviewSchema) })
