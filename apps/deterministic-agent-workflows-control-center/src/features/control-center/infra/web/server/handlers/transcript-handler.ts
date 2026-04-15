import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http'
import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs'
import type {
  TranscriptEntry,
  TranscriptResponse as TranscriptResponseBody,
  TranscriptTotals,
} from '../../api-types'
export type {
  TranscriptEntry,
  TranscriptResponse as TranscriptResponseBody,
  TranscriptTotals,
} from '../../api-types'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import { getTranscriptPath } from '../../../../domain/query/session-queries'
import type { RouteParams } from '../router'
import {
  sendError,
  sendJson,
} from '../router'

/** @riviere-role web-tbc */
export type TranscriptHandlerDeps = { readonly queryDeps: SessionQueryDeps }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseEntries(path: string): Array<TranscriptEntry> {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const entries: Array<TranscriptEntry> = []
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed)) {
        continue
      }
      const type = parsed['type']
      const timestamp = parsed['timestamp']
      if (typeof type !== 'string' || typeof timestamp !== 'string') {
        continue
      }
      if (type === 'system') {
        const text = typeof parsed['text'] === 'string' ? parsed['text'] : 'unknown'
        entries.push({
          type: 'system',
          timestamp,
          content: [{
            kind: 'text',
            text,
          }],
        })
        continue
      }
      if (type !== 'assistant' && type !== 'user') {
        continue
      }
      entries.push({
        type,
        timestamp,
        content: [{
          kind: 'text',
          text: line,
        }],
      })
    } catch {
      continue
    }
  }
  return entries
}

function totals(entries: ReadonlyArray<TranscriptEntry>): TranscriptTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    assistantMessages: entries.filter((entry) => entry.type === 'assistant').length,
  }
}

function modelNames(path: string): Array<string> {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const modelRegex = /"model"\s*:\s*"([^"]+)"/
  return lines.flatMap((line) => {
    const match = modelRegex.exec(line)
    return match?.[1] === undefined ? [] : [match[1]]
  })
}

function toolCounts(path: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  for (const line of lines) {
    const matches = [...line.matchAll(/"name"\s*:\s*"([^"]+)"/g)]
    for (const match of matches) {
      const name = String(match[1])
      const count = counts[name] ?? 0
      counts[name] = count + 1
    }
  }
  return counts
}

function metadata(path: string): {
  readonly fileSize?: number;
  readonly fileModified?: string 
} {
  const info = statSync(path)
  return {
    fileSize: info.size,
    fileModified: info.mtime.toISOString(),
  }
}

/** @riviere-role web-tbc */
export function handleGetTranscript(
  deps: TranscriptHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (sessionId === undefined) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const transcriptPath = getTranscriptPath(deps.queryDeps, sessionId)
    if (transcriptPath === null) {
      sendError(res, 404, 'No transcript path for this session')
      return
    }
    if (!existsSync(transcriptPath)) {
      sendError(res, 404, `Transcript file not found: ${transcriptPath}`)
      return
    }
    if (!transcriptPath.endsWith('.jsonl')) {
      sendError(res, 422, `Unsupported transcript format: ${transcriptPath}`)
      return
    }

    const entries = parseEntries(transcriptPath)
    const fileMeta = metadata(transcriptPath)
    const body: TranscriptResponseBody = {
      entries,
      total: entries.length,
      transcriptPath,
      totals: totals(entries),
      toolCounts: toolCounts(transcriptPath),
      modelsUsed: modelNames(transcriptPath),
      ...(fileMeta.fileSize === undefined ? {} : { fileSize: fileMeta.fileSize }),
      ...(fileMeta.fileModified === undefined ? {} : { fileModified: fileMeta.fileModified }),
    }

    sendJson(res, 200, body)
  }
}
