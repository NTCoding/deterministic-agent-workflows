import { z } from 'zod'
import { nonEmptyStringSchema } from './non-empty-string'

const issueRecordedSchema = z.object({
  type: z.literal('issue-recorded'),
  at: nonEmptyStringSchema,
  issueNumber: z.number(),
})

const branchRecordedSchema = z.object({
  type: z.literal('branch-recorded'),
  at: nonEmptyStringSchema,
  branch: nonEmptyStringSchema,
})

const prRecordedSchema = z.object({
  type: z.literal('pr-recorded'),
  at: nonEmptyStringSchema,
  prNumber: z.number(),
})

export const repositoryMetadataEventSchema = z.discriminatedUnion('type', [
  issueRecordedSchema,
  branchRecordedSchema,
  prRecordedSchema,
])

/** @riviere-role value-object */
export type DomainMetadataEvent = z.infer<typeof repositoryMetadataEventSchema>
/** @riviere-role value-object */
export type IssueRecordedEvent = z.infer<typeof issueRecordedSchema>
/** @riviere-role value-object */
export type BranchRecordedEvent = z.infer<typeof branchRecordedSchema>
/** @riviere-role value-object */
export type PrRecordedEvent = z.infer<typeof prRecordedSchema>
