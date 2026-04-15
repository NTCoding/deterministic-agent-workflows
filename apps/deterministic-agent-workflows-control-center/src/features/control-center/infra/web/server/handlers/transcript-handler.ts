import type {
  IncomingMessage, ServerResponse 
} from 'node:http'
import {
  readFileSync, existsSync, statSync 
} from 'node:fs'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import { getTranscriptPath } from '../../../../domain/query/session-queries'
import type { RouteParams } from '../router'
import {
  sendJson, sendError 
} from '../router'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'

/** @riviere-role web-tbc */
export type TranscriptHandlerDeps = {readonly queryDeps: SessionQueryDeps}

/** @riviere-role web-tbc */
export type TranscriptUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
}

/** @riviere-role web-tbc */
export type TranscriptEntry = {
  readonly type: 'assistant' | 'user' | 'system' | 'other'
  readonly timestamp: string
  readonly content: ReadonlyArray<TranscriptContentBlock>
  readonly messageId?: string
  readonly parentUuid?: string | null
  readonly isSidechain?: boolean
  readonly model?: string
  readonly stopReason?: string
  readonly usage?: TranscriptUsage
}

/** @riviere-role web-tbc */
export type TranscriptContentBlock =
  | {
    readonly kind: 'text';
    readonly text: string 
  }
  | {
    readonly kind: 'thinking';
    readonly text: string 
  }
  | {
    readonly kind: 'tool_use';
    readonly id: string;
    readonly name: string;
    readonly input: Record<string, unknown> 
  }
  | {
    readonly kind: 'tool_result';
    readonly toolUseId: string;
    readonly toolName: string;
    readonly text: string;
    readonly isError: boolean 
  }

/** @riviere-role web-tbc */
export type TranscriptTotals = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
  readonly assistantMessages: number
}

/** @riviere-role web-tbc */
export type TranscriptResponseBody = {
  readonly entries: ReadonlyArray<TranscriptEntry>
  readonly total: number
  readonly transcriptPath: string
  readonly fileSize?: number
  readonly fileModified?: string
  readonly totals: TranscriptTotals
  readonly toolCounts: Record<string, number>
  readonly modelsUsed: ReadonlyArray<string>
}

function parseContentBlock(block: unknown, toolNames: Map<string, string>): TranscriptContentBlock | null {
  if (typeof block !== 'object' || block === null) return null
  const b = block as Record<string, unknown>
  const type = b['type']

  if (type === 'text' && typeof b['text'] === 'string') {
    const text = b['text'].trim()
    if (!text) return null
    return {
      kind: 'text',
      text 
    }
  }

  if (type === 'thinking' && typeof b['thinking'] === 'string') {
    const text = b['thinking'].trim()
    if (!text) return null
    return {
      kind: 'thinking',
      text 
    }
  }

  if (type === 'tool_use' && typeof b['name'] === 'string') {
    const id = typeof b['id'] === 'string' ? b['id'] : ''
    const name = b['name'] as string
    if (id) toolNames.set(id, name)
    return {
      kind: 'tool_use',
      id,
      name,
      input: (typeof b['input'] === 'object' && b['input'] !== null ? b['input'] : {}) as Record<string, unknown>,
    }
  }

  if (type === 'tool_result') {
    const id = typeof b['tool_use_id'] === 'string' ? b['tool_use_id'] : ''
    const toolName = toolNames.get(id) ?? 'tool'
    const isError = b['is_error'] === true
    const content = b['content']
    let text = ''
    if (Array.isArray(content)) {
      text = content.flatMap((c: unknown) => {
        if (typeof c === 'object' && c !== null && (c as Record<string,unknown>)['type'] === 'text') {
          return [(c as Record<string,unknown>)['text'] as string]
        }
        return []
      }).join('\n')
    } else if (typeof content === 'string') {
      text = content
    }
    return {
      kind: 'tool_result',
      toolUseId: id,
      toolName,
      text: text.slice(0, 4000),
      isError 
    }
  }

  return null
}

function parseUsage(raw: unknown): TranscriptUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const u = raw as Record<string, unknown>
  const num = (k: string): number => (typeof u[k] === 'number' ? u[k] as number : 0)
  return {
    inputTokens: num('input_tokens'),
    outputTokens: num('output_tokens'),
    cacheReadInputTokens: num('cache_read_input_tokens'),
    cacheCreationInputTokens: num('cache_creation_input_tokens'),
  }
}

function parseEntry(line: string, toolNames: Map<string, string>): TranscriptEntry | null {
  let obj: unknown
  try { obj = JSON.parse(line) } catch { return null }
  if (typeof obj !== 'object' || obj === null) return null
  const entry = obj as Record<string, unknown>

  const timestamp = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : new Date().toISOString()
  const parentUuid = typeof entry['parentUuid'] === 'string' ? entry['parentUuid'] : null
  const isSidechain = entry['isSidechain'] === true

  if (entry['type'] === 'assistant' || entry['type'] === 'user') {
    const msg = entry['message'] as Record<string, unknown> | undefined
    if (!msg) return null
    const rawContent = Array.isArray(msg['content']) ? msg['content'] : []
    const content = rawContent.flatMap((block: unknown) => {
      const parsed = parseContentBlock(block, toolNames)
      return parsed ? [parsed] : []
    })
    if (content.length === 0) return null
    const result: TranscriptEntry = {
      type: entry['type'] as 'assistant' | 'user',
      timestamp,
      content,
      parentUuid,
      isSidechain,
      ...(typeof msg['id'] === 'string' ? { messageId: msg['id'] as string } : {}),
      ...(typeof msg['model'] === 'string' ? { model: msg['model'] as string } : {}),
      ...(typeof msg['stop_reason'] === 'string' ? { stopReason: msg['stop_reason'] as string } : {}),
      ...(parseUsage(msg['usage']) ? { usage: parseUsage(msg['usage'])! } : {}),
    }
    return result
  }

  if (entry['type'] === 'system') {
    const text = typeof entry['text'] === 'string' ? entry['text'] : JSON.stringify(entry)
    return {
      type: 'system',
      timestamp,
      content: [{
        kind: 'text',
        text: text.slice(0, 500) 
      }],
      parentUuid,
      isSidechain 
    }
  }

  return null
}

type OpencodePartRow = {
  readonly message_id: string
  readonly role: string
  readonly time_created: number
  readonly part_data: string
}

function readOpencodeTranscript(dbPath: string, sessionId: string): TranscriptEntry[] {
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
      `).all(sessionId) as unknown[]

    const entriesByMessage = new Map<string, OpencodePartRow[]>()
    for (const row of rows) {
      const r = row as Record<string, unknown>
      const msgId = r['message_id'] as string
      if (!entriesByMessage.has(msgId)) {
        entriesByMessage.set(msgId, [])
      }
      entriesByMessage.get(msgId)!.push({
        message_id: msgId,
        role: (typeof r['role'] === 'string' ? r['role'] : 'other') as string,
        time_created: (typeof r['time_created'] === 'number' ? r['time_created'] : 0) as number,
        part_data: (typeof r['part_data'] === 'string' ? r['part_data'] : '{}') as string,
      })
    }

    const entries: TranscriptEntry[] = []
    for (const [msgId, partRows] of entriesByMessage) {
      if (partRows.length === 0) continue
      const first = partRows[0]
      if (!first) continue
      const role = first.role
      const timestamp = new Date(first.time_created).toISOString()
      const type: 'assistant' | 'user' | 'system' | 'other' = (
        role === 'assistant' ? 'assistant' :
          role === 'user' ? 'user' :
            'other'
      )

      const content: TranscriptContentBlock[] = []
      for (const part of partRows) {
        let partObj: unknown
        try { partObj = JSON.parse(part.part_data) } catch { continue }
        if (typeof partObj !== 'object' || partObj === null) continue
        const p = partObj as Record<string, unknown>
        const partType = p['type'] as string | undefined

        if (partType === 'text') {
          const text = typeof p['text'] === 'string' ? (p['text'] as string).trim() : ''
          if (text) content.push({
            kind: 'text',
            text 
          })
        } else if (partType === 'tool') {
          const toolName = typeof p['tool'] === 'string' ? p['tool'] : 'tool'
          const toolId = typeof p['id'] === 'string' ? p['id'] : ''
          const state = typeof p['state'] === 'object' && p['state'] !== null ? p['state'] as Record<string, unknown> : {}
          const input = (typeof state['input'] === 'object' && state['input'] !== null ? state['input'] : {}) as Record<string, unknown>
          const output = state['output']
          content.push({
            kind: 'tool_use',
            id: toolId,
            name: toolName,
            input 
          })
          if (output !== undefined) {
            const outputText = typeof output === 'string' ? output : JSON.stringify(output)
            content.push({
              kind: 'tool_result',
              toolUseId: toolId,
              toolName,
              text: outputText.slice(0, 4000),
              isError: false 
            })
          }
        }
      }

      if (content.length > 0) {
        entries.push({
          type,
          timestamp,
          content,
          messageId: msgId 
        })
      }
    }

    return entries
  } finally {
    db.close()
  }
}

function computeTotals(entries: ReadonlyArray<TranscriptEntry>): TranscriptTotals {
  const t = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    assistantMessages: 0 
  }
  for (const e of entries) {
    if (e.type === 'assistant') t.assistantMessages++
    if (!e.usage) continue
    t.inputTokens += e.usage.inputTokens
    t.outputTokens += e.usage.outputTokens
    t.cacheReadInputTokens += e.usage.cacheReadInputTokens
    t.cacheCreationInputTokens += e.usage.cacheCreationInputTokens
  }
  return t
}

function computeToolCounts(entries: ReadonlyArray<TranscriptEntry>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of entries) {
    for (const b of e.content) {
      if (b.kind === 'tool_use') counts[b.name] = (counts[b.name] ?? 0) + 1
    }
  }
  return counts
}

function computeModelsUsed(entries: ReadonlyArray<TranscriptEntry>): string[] {
  const set = new Set<string>()
  for (const e of entries) {
    if (typeof e.model === 'string' && e.model.length > 0) set.add(e.model)
  }
  return [...set]
}

/** @riviere-role web-tbc */
export function handleGetTranscript(
  deps: TranscriptHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const transcriptPath = getTranscriptPath(deps.queryDeps, sessionId)
    if (!transcriptPath) {
      sendError(res, 404, 'No transcript path for this session')
      return
    }
    if (!existsSync(transcriptPath)) {
      sendError(res, 404, `Transcript file not found: ${transcriptPath}`)
      return
    }

    let entries: TranscriptEntry[] = []

    try {
      if (transcriptPath.endsWith('.jsonl')) {
        const raw = readFileSync(transcriptPath, 'utf8')
        const lines = raw.split('\n').filter(l => l.trim())
        const toolNames = new Map<string, string>()
        entries = lines.flatMap(line => {
          const parsed = parseEntry(line, toolNames)
          return parsed ? [parsed] : []
        })
      } else if (transcriptPath.endsWith('.db')) {
        entries = readOpencodeTranscript(transcriptPath, sessionId)
      } else {
        sendError(res, 422, `Unsupported transcript format: ${transcriptPath}`)
        return
      }
    } catch (error) {
      sendError(res, 500, `Failed to read transcript: ${String(error)}`)
      return
    }

    let fileSize: number | undefined
    let fileModified: string | undefined
    try {
      const s = statSync(transcriptPath)
      fileSize = s.size
      fileModified = s.mtime.toISOString()
    } catch { /* ignore */ }

    const body: TranscriptResponseBody = {
      entries,
      total: entries.length,
      transcriptPath,
      ...(fileSize !== undefined ? { fileSize } : {}),
      ...(fileModified !== undefined ? { fileModified } : {}),
      totals: computeTotals(entries),
      toolCounts: computeToolCounts(entries),
      modelsUsed: computeModelsUsed(entries),
    }
    sendJson(res, 200, body)
  }
}
