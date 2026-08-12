import { z } from 'zod'

export const codexHookInputSchema = z.object({
  session_id: z.string().min(1),
  transcript_path: z.string().nullable(),
  cwd: z.string().min(1),
  hook_event_name: z.enum(['SessionStart', 'PreToolUse', 'SubagentStart', 'Stop']),
})

export const codexPreToolUseInputSchema = codexHookInputSchema.extend({
  hook_event_name: z.literal('PreToolUse'),
  tool_name: z.string().min(1),
  tool_input: z.record(z.unknown()),
})

export const codexSubagentStartInputSchema = codexHookInputSchema.extend({
  hook_event_name: z.literal('SubagentStart'),
  agent_id: z.string().min(1),
  agent_type: z.string().min(1),
})

export type CodexHookInput = z.infer<typeof codexHookInputSchema>
