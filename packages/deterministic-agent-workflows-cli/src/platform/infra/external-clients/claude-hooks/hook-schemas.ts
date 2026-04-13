import { z } from 'zod'

const hookCommonInputSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  permission_mode: z.string().optional(),
  hook_event_name: z.string(),
})

const preToolUseInputSchema = hookCommonInputSchema.extend({
  tool_name: z.string(),
  tool_input: z.record(z.unknown()),
  tool_use_id: z.string(),
})

const subagentStartInputSchema = hookCommonInputSchema.extend({
  agent_id: z.string(),
  agent_type: z.string(),
})

const teammateIdleInputSchema = hookCommonInputSchema.extend({teammate_name: z.string().optional(),})

/** @riviere-role external-client-model */
export type PreToolUseInput = z.infer<typeof preToolUseInputSchema>
/** @riviere-role external-client-model */
export type SubagentStartInput = z.infer<typeof subagentStartInputSchema>
/** @riviere-role external-client-model */
export type TeammateIdleInput = z.infer<typeof teammateIdleInputSchema>

export {
  hookCommonInputSchema,
  preToolUseInputSchema,
  subagentStartInputSchema,
  teammateIdleInputSchema,
}
