import { z } from 'zod'

export const baseEventSchema = z.object({
  type: z.string(),
  at: z.string(),
}).passthrough()

/** @riviere-role value-object */
export type BaseEvent = z.infer<typeof baseEventSchema>
