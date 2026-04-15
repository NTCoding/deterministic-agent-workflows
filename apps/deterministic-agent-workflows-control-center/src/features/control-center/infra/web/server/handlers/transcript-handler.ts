import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import { getTranscriptPath } from '../../../../domain/query/session-queries'
import type { RouteParams } from '../router'
import { sendJson, sendError } from '../router'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'

export type TranscriptHandlerDeps = {
  readonly queryDeps: SessionQueryDeps
}

export type TranscriptEntry = {
  readonly type: 'assistant' | 'user' | 'system' | 'other'
  readonly timestamp: string
  readonly content: ReadonlyArray<TranscriptContentBlock>
}

export type TranscriptContentBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool_use'; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly kind: 'tool_result'; readonly toolName: string; readonly text: string }

function parseContentBlock(block: unknown, toolNames: Map<string, string>): TranscriptContentBlock | null {
  if (typeof block !== 'object' || block === null) return null
  const b = block as Record<string, unknown>
  if (b['type'] === 'text' && typeof b['text'] === 'string') {
    const text = b['text'].trim()
    if (!text) return null
    return { kind: 'text', text }
  }
  if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
    const name = b['name'] as string
    if (typeof b['id'] === 'string') toolNames.set(b['id'] as string, name)
    return {
      kind: 'tool_use',
      name,
      input: (typeof b['input'] === 'object' && b['input'] !== null ? b['input'] : {}) as Record<string, unknown>,
    }
  }
  if (b['type'] === 'tool_result') {
    const id = typeof b['tool_use_id'] === 'string' ? b['tool_use_id'] as string : ''
    const toolName = toolNames.get(id) ?? 'tool'
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
    return { kind: 'tool_result', toolName, text: text.slice(0, 2000) }
  }
  return null
}

function parseEntry(line: string, toolNames: Map<string, string>): TranscriptEntry | null {
  let obj: unknown
  try { obj = JSON.parse(line) } catch { return null }
  if (typeof obj !== 'object' || obj === null) return null
  const entry = obj as Record<string, unknown>

  const timestamp = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : new Date().toISOString()

  if (entry['type'] === 'assistant' || entry['type'] === 'user') {
    const msg = entry['message'] as Record<string, unknown> | undefined
    if (!msg) return null
    const rawContent = Array.isArray(msg['content']) ? msg['content'] : []
    const content = rawContent.flatMap((block: unknown) => {
      const parsed = parseContentBlock(block, toolNames)
      return parsed ? [parsed] : []
    })
    if (content.length === 0) return null
    return { type: entry['type'] as 'assistant' | 'user', timestamp, content }
  }

  if (entry['type'] === 'system') {
    const text = typeof entry['text'] === 'string' ? entry['text'] : JSON.stringify(entry)
    return { type: 'system', timestamp, content: [{ kind: 'text', text: text.slice(0, 500) }] }
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
  try {
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
      for (const [, partRows] of entriesByMessage) {
        if (partRows.length === 0) continue
        const first = partRows[0]
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
            if (text) content.push({ kind: 'text', text })
          } else if (partType === 'tool') {
            const toolName = typeof p['tool'] === 'string' ? p['tool'] : 'tool'
            const state = typeof p['state'] === 'object' && p['state'] !== null ? p['state'] as Record<string, unknown> : {}
            const input = typeof state['input'] === 'object' && state['input'] !== null ? state['input'] : {}
            const output = state['output']
            content.push({ kind: 'tool_use', name: toolName, input })
            if (output !== undefined) {
              const outputText = typeof output === 'string' ? output : JSON.stringify(output)
              content.push({ kind: 'tool_result', toolName, text: outputText.slice(0, 2000) })
            }
          }
        }

        if (content.length > 0) {
          entries.push({ type, timestamp, content })
        }
      }

      return entries
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

export function handleGetTranscript(
  deps: TranscriptHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    console.log(`[transcript] sessionId=${sessionId}`)
    const transcriptPath = getTranscriptPath(deps.queryDeps, sessionId)
    console.log(`[transcript] path=${transcriptPath}`)
    if (!transcriptPath) {
      sendError(res, 404, 'No transcript path for this session')
      return
    }
    if (!existsSync(transcriptPath)) {
      console.log(`[transcript] file not found: ${transcriptPath}`)
      sendError(res, 404, `Transcript file not found: ${transcriptPath}`)
      return
    }

    let entries: TranscriptEntry[] = []

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

    sendJson(res, 200, { entries, total: entries.length, transcriptPath })
  }
}
