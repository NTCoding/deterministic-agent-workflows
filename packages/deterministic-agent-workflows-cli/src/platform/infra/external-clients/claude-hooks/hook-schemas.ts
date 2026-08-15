import { z } from 'zod'

const hookCommonInputSchema = z.object({
  session_id: z.string().trim().min(1),
  transcript_path: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
  permission_mode: z.string().optional(),
  hook_event_name: z.string().trim().min(1),
})

const preToolUseInputSchema = hookCommonInputSchema.extend({
  tool_name: z.string().trim().min(1),
  tool_input: z.record(z.unknown()),
  tool_use_id: z.string().trim().min(1),
})

const subagentStartInputSchema = hookCommonInputSchema.extend({
  agent_id: z.string().trim().min(1),
  agent_type: z.string().trim().min(1),
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
