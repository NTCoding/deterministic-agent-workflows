import { z } from 'zod'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type {
  TranscriptContentBlock, TranscriptEntry 
} from './transcript-types'
import { safeParseJson } from './transcript-types'

const opencodePartSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  tool: z.string().optional(),
  id: z.string().optional(),
  state: z.object({
    input: z.record(z.unknown()).optional(),
    output: z.unknown().optional(),
  }).optional(),
})
const opencodeRowSchema = z.object({
  message_id: z.string(),
  role: z.string().nullable(),
  time_created: z.number(),
  part_data: z.string(),
})

type OpencodePartRow = z.infer<typeof opencodeRowSchema>
type OpencodePart = z.infer<typeof opencodePartSchema>

function normaliseRole(role: string): 'assistant' | 'user' | 'system' | 'other' {
  if (role === 'assistant') return 'assistant'
  if (role === 'user') return 'user'
  return 'other'
}

function parseOpencodeTextPart(part: OpencodePart): TranscriptContentBlock | null {
  if (part.type !== 'text' || part.text === undefined) return null
  const text = part.text.trim()
  if (text.length === 0) return null
  return {
    kind: 'text',
    text,
  }
}

function parseOpencodeToolParts(part: OpencodePart): ReadonlyArray<TranscriptContentBlock> {
  if (part.type !== 'tool') return []
  const toolName = part.tool ?? 'tool'
  const toolId = typeof part.id === 'string' ? part.id : ''
  const input = part.state?.input ?? {}
  const output = part.state?.output
  const blocks: Array<TranscriptContentBlock> = [{
    kind: 'tool_use',
    id: toolId,
    name: toolName,
    input,
  }]
  if (output === undefined) return blocks
  const outputText = typeof output === 'string' ? output : JSON.stringify(output)
  blocks.push({
    kind: 'tool_result',
    toolUseId: toolId,
    toolName,
    text: outputText.slice(0, 4000),
    isError: false,
  })
  return blocks
}

function parseOpencodePart(partData: string): ReadonlyArray<TranscriptContentBlock> {
  const parsed = opencodePartSchema.safeParse(safeParseJson(partData))
  if (!parsed.success) return []
  const textBlock = parseOpencodeTextPart(parsed.data)
  if (textBlock) return [textBlock]
  return parseOpencodeToolParts(parsed.data)
}

function groupPartsByMessage(rows: ReadonlyArray<unknown>): Map<string, Array<OpencodePartRow>> {
  const byMessage = new Map<string, Array<OpencodePartRow>>()
  for (const row of rows) {
    const parsed = opencodeRowSchema.safeParse(row)
    if (!parsed.success) continue
    const existing = byMessage.get(parsed.data.message_id) ?? []
    existing.push(parsed.data)
    byMessage.set(parsed.data.message_id, existing)
  }
  return byMessage
}

function buildOpencodeEntry(msgId: string, partRows: ReadonlyArray<OpencodePartRow>): TranscriptEntry | null {
  const first = partRows[0]
  if (!first) return null
  const timestamp = new Date(first.time_created).toISOString()
  const type = normaliseRole(first.role ?? 'other')
  const content: Array<TranscriptContentBlock> = []
  for (const part of partRows) content.push(...parseOpencodePart(part.part_data))
  if (content.length === 0) return null
  return {
    type,
    timestamp,
    content,
    messageId: msgId,
  }
}

/** @riviere-role web-tbc */
export function readOpencodeTranscript(dbPath: string, sessionId: string): ReadonlyArray<TranscriptEntry> {
  const db = openSqliteDatabase(dbPath, { readonly: true })
  try {
    const rows = db.prepare(`
      SELECT m.id as message_id,
             json_extract(m.data, '$.role') as role,
             m.time_created,
             p.data as part_data
      FROM message m
      JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY m.time_created ASC, p.time_created ASC
    `).all(sessionId)
    const byMessage = groupPartsByMessage(rows)
    const entries: Array<TranscriptEntry> = []
    for (const [msgId, partRows] of byMessage) {
      const entry = buildOpencodeEntry(msgId, partRows)
      if (entry) entries.push(entry)
    }
    return entries
  } finally {
    db.close()
  }
}
