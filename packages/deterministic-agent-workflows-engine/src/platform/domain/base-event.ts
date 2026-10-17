import { z } from 'zod'
import { nonEmptyStringSchema } from './non-empty-string'

export const baseEventSchema = z.object({
  type: nonEmptyStringSchema,
  at: nonEmptyStringSchema,
}).passthrough()

/** @riviere-role value-object */
export type BaseEvent = z.infer<typeof baseEventSchema>
