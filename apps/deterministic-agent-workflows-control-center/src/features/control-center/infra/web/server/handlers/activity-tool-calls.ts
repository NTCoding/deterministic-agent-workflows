import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type { ToolCall } from './activity-types'
import {
  parseTs, safeParseJson 
} from './activity-types'

const jsonlToolUseSchema = z.object({
  type: z.literal('tool_use'),
  name: z.string(),
  input: z.record(z.unknown()).optional(),
})
const jsonlAssistantSchema = z.object({
  type: z.literal('assistant'),
  timestamp: z.string().optional(),
  message: z.object({content: z.array(z.unknown()).optional(),}).optional(),
})
const opencodeActivityRowSchema = z.object({
  m_time: z.number().nullable(),
  p_time: z.number().nullable(),
  part_data: z.string(),
})
const opencodeToolPartSchema = z.object({
  type: z.literal('tool'),
  tool: z.string(),
  state: z.object({input: z.record(z.unknown()).optional(),}).optional(),
})

function collectToolUses(content: ReadonlyArray<unknown>, ts: number): ReadonlyArray<ToolCall> {
  const results: Array<ToolCall> = []
  for (const block of content) {
    const parsed = jsonlToolUseSchema.safeParse(block)
    if (!parsed.success) continue
    results.push({
      name: parsed.data.name,
      input: parsed.data.input ?? {},
      timestampMs: ts,
    })
  }
  return results
}

function extractToolCallsFromJsonlLine(line: string): ReadonlyArray<ToolCall> {
  const parsed = jsonlAssistantSchema.safeParse(safeParseJson(line))
  if (!parsed.success) return []
  const content = parsed.data.message?.content ?? []
  return collectToolUses(content, parseTs(parsed.data.timestamp))
}

/** @riviere-role web-tbc */
export function extractToolCallsFromJsonl(path: string): ReadonlyArray<ToolCall> {
  const raw = readFileSync(path, 'utf8')
  return raw.split('\n').filter(l => l.trim()).flatMap(extractToolCallsFromJsonlLine)
}

function extractOpencodeToolCall(row: unknown): ToolCall | null {
  const parsedRow = opencodeActivityRowSchema.safeParse(row)
  if (!parsedRow.success) return null
  const pTime = parsedRow.data.p_time ?? 0
  const mTime = parsedRow.data.m_time ?? 0
  const ts = pTime === 0 ? mTime : pTime
  const parsedPart = opencodeToolPartSchema.safeParse(safeParseJson(parsedRow.data.part_data))
  if (!parsedPart.success) return null
  return {
    name: parsedPart.data.tool,
    input: parsedPart.data.state?.input ?? {},
    timestampMs: ts,
  }
}

/** @riviere-role web-tbc */
export function extractToolCallsFromOpencode(dbPath: string, sessionId: string): ReadonlyArray<ToolCall> {
  const db = openSqliteDatabase(dbPath, { readonly: true })
  try {
    const rows = db.prepare(`
      SELECT m.time_created as m_time, p.time_created as p_time, p.data as part_data
      FROM message m
      JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY m.time_created ASC, p.time_created ASC
    `).all(sessionId)
    const calls: Array<ToolCall> = []
    for (const row of rows) {
      const call = extractOpencodeToolCall(row)
      if (call) calls.push(call)
    }
    return calls
  } finally {
    db.close()
  }
}
