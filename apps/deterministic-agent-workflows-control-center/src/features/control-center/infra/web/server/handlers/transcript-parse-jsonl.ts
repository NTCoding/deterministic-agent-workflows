import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type {
  TranscriptContentBlock, TranscriptEntry, TranscriptUsage 
} from './transcript-types'
import { safeParseJson } from './transcript-types'

const textPartRawSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})
const nestedTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})
const thinkingBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
})
const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().optional(),
  name: z.string(),
  input: z.record(z.unknown()).optional(),
})
const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().optional(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
})
const usageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
})
const messageSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  stop_reason: z.string().optional(),
  usage: z.unknown().optional(),
  content: z.array(z.unknown()).optional(),
})
const jsonlEntrySchema = z.object({
  type: z.union([z.literal('assistant'), z.literal('user'), z.literal('system')]).optional(),
  timestamp: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  isSidechain: z.boolean().optional(),
  message: messageSchema.optional(),
  text: z.string().optional(),
})

function parseTextBlock(block: unknown): TranscriptContentBlock | null {
  const parsed = textPartRawSchema.safeParse(block)
  if (!parsed.success) return null
  const text = parsed.data.text.trim()
  if (text.length === 0) return null
  return {
    kind: 'text',
    text,
  }
}

function parseThinkingBlock(block: unknown): TranscriptContentBlock | null {
  const parsed = thinkingBlockSchema.safeParse(block)
  if (!parsed.success) return null
  const text = parsed.data.thinking.trim()
  if (text.length === 0) return null
  return {
    kind: 'thinking',
    text,
  }
}

function parseToolUseBlock(block: unknown, toolNames: Map<string, string>): TranscriptContentBlock | null {
  const parsed = toolUseBlockSchema.safeParse(block)
  if (!parsed.success) return null
  const id = typeof parsed.data.id === 'string' ? parsed.data.id : ''
  if (id.length > 0) toolNames.set(id, parsed.data.name)
  return {
    kind: 'tool_use',
    id,
    name: parsed.data.name,
    input: parsed.data.input ?? {},
  }
}

function collectToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: Array<string> = []
  for (const entry of content) {
    const parsed = nestedTextPartSchema.safeParse(entry)
    if (parsed.success) parts.push(parsed.data.text)
  }
  return parts.join('\n')
}

function parseToolResultBlock(block: unknown, toolNames: Map<string, string>): TranscriptContentBlock | null {
  const parsed = toolResultBlockSchema.safeParse(block)
  if (!parsed.success) return null
  const id = typeof parsed.data.tool_use_id === 'string' ? parsed.data.tool_use_id : ''
  const toolName = toolNames.get(id) ?? 'tool'
  const text = collectToolResultText(parsed.data.content)
  return {
    kind: 'tool_result',
    toolUseId: id,
    toolName,
    text: text.slice(0, 4000),
    isError: parsed.data.is_error === true,
  }
}

function parseContentBlock(block: unknown, toolNames: Map<string, string>): TranscriptContentBlock | null {
  return parseTextBlock(block)
    ?? parseThinkingBlock(block)
    ?? parseToolUseBlock(block, toolNames)
    ?? parseToolResultBlock(block, toolNames)
}

function parseUsage(raw: unknown): TranscriptUsage | undefined {
  const parsed = usageSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return {
    inputTokens: parsed.data.input_tokens ?? 0,
    outputTokens: parsed.data.output_tokens ?? 0,
    cacheReadInputTokens: parsed.data.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: parsed.data.cache_creation_input_tokens ?? 0,
  }
}

function buildAssistantOrUserEntry(
  type: 'assistant' | 'user',
  timestamp: string,
  parentUuid: string | null,
  isSidechain: boolean,
  message: z.infer<typeof messageSchema>,
  toolNames: Map<string, string>,
): TranscriptEntry | null {
  const rawContent = message.content ?? []
  const content = rawContent.flatMap((block: unknown) => {
    const parsed = parseContentBlock(block, toolNames)
    return parsed ? [parsed] : []
  })
  if (content.length === 0) return null
  const usage = parseUsage(message.usage)
  return {
    type,
    timestamp,
    content,
    parentUuid,
    isSidechain,
    ...(message.id === undefined ? {} : {messageId: message.id,}),
    ...(message.model === undefined ? {} : {model: message.model,}),
    ...(message.stop_reason === undefined ? {} : {stopReason: message.stop_reason,}),
    ...(usage === undefined ? {} : {usage,}),
  }
}

function buildSystemEntry(timestamp: string, parentUuid: string | null, isSidechain: boolean, raw: unknown): TranscriptEntry {
  const parsed = jsonlEntrySchema.safeParse(raw)
  const text = parsed.success && parsed.data.text !== undefined ? parsed.data.text : JSON.stringify(raw)
  return {
    type: 'system',
    timestamp,
    content: [{
      kind: 'text',
      text: text.slice(0, 500),
    }],
    parentUuid,
    isSidechain,
  }
}

function parseJsonlLine(line: string, toolNames: Map<string, string>): TranscriptEntry | null {
  const obj = safeParseJson(line)
  const parsed = jsonlEntrySchema.safeParse(obj)
  if (!parsed.success) return null
  const data = parsed.data
  const timestamp = data.timestamp ?? new Date().toISOString()
  const parentUuid = data.parentUuid ?? null
  const isSidechain = data.isSidechain === true
  if (data.type === 'assistant' || data.type === 'user') {
    return data.message ? buildAssistantOrUserEntry(data.type, timestamp, parentUuid, isSidechain, data.message, toolNames) : null
  }
  if (data.type === 'system') return buildSystemEntry(timestamp, parentUuid, isSidechain, obj)
  return null
}

/** @riviere-role web-tbc */
export function parseJsonlTranscript(path: string): ReadonlyArray<TranscriptEntry> {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const toolNames = new Map<string, string>()
  return lines.flatMap(line => {
    const parsed = parseJsonlLine(line, toolNames)
    return parsed ? [parsed] : []
  })
}
