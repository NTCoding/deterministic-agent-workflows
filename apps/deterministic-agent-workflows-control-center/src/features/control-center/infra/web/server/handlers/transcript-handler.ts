import type {
  IncomingMessage, ServerResponse 
} from 'node:http'
import {
  existsSync, statSync 
} from 'node:fs'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import { getTranscriptPath } from '../../../../domain/query/session-queries'
import type { RouteParams } from '../router'
import {
  sendJson, sendError 
} from '../router'
import type {
  TranscriptEntry, TranscriptResponseBody, TranscriptTotals 
} from './transcript-types'
import { parseJsonlTranscript } from './transcript-parse-jsonl'
import { readOpencodeTranscript } from './transcript-parse-opencode'

export type {
  TranscriptEntry, TranscriptContentBlock, TranscriptUsage, TranscriptTotals, TranscriptResponseBody 
} from './transcript-types'

/** @riviere-role web-tbc */
export type TranscriptHandlerDeps = {readonly queryDeps: SessionQueryDeps}

function accumulateTotals(acc: TranscriptTotals, entry: TranscriptEntry): TranscriptTotals {
  const assistantMessages = entry.type === 'assistant' ? acc.assistantMessages + 1 : acc.assistantMessages
  if (entry.usage === undefined) return {
    ...acc,
    assistantMessages,
  }
  return {
    inputTokens: acc.inputTokens + entry.usage.inputTokens,
    outputTokens: acc.outputTokens + entry.usage.outputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + entry.usage.cacheReadInputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens + entry.usage.cacheCreationInputTokens,
    assistantMessages,
  }
}

function computeTotals(entries: ReadonlyArray<TranscriptEntry>): TranscriptTotals {
  const seed: TranscriptTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    assistantMessages: 0,
  }
  return entries.reduce(accumulateTotals, seed)
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

type LoadResult = {
  readonly entries: ReadonlyArray<TranscriptEntry>;
  readonly status: 'ok' | 'unsupported'
}

function loadEntries(transcriptPath: string, sessionId: string): LoadResult {
  if (transcriptPath.endsWith('.jsonl')) return {
    entries: parseJsonlTranscript(transcriptPath),
    status: 'ok',
  }
  if (transcriptPath.endsWith('.db')) return {
    entries: readOpencodeTranscript(transcriptPath, sessionId),
    status: 'ok',
  }
  return {
    entries: [],
    status: 'unsupported',
  }
}

type FileStats = {
  readonly fileSize?: number;
  readonly fileModified?: string
}

function readFileStats(path: string): FileStats {
  try {
    const s = statSync(path)
    return {
      fileSize: s.size,
      fileModified: s.mtime.toISOString(),
    }
  } catch {
    return {}
  }
}

function buildResponseBody(
  transcriptPath: string,
  entries: ReadonlyArray<TranscriptEntry>,
  stats: FileStats,
): TranscriptResponseBody {
  return {
    entries,
    total: entries.length,
    transcriptPath,
    ...(stats.fileSize === undefined ? {} : {fileSize: stats.fileSize,}),
    ...(stats.fileModified === undefined ? {} : {fileModified: stats.fileModified,}),
    totals: computeTotals(entries),
    toolCounts: computeToolCounts(entries),
    modelsUsed: computeModelsUsed(entries),
  }
}

function tryLoadEntries(transcriptPath: string, sessionId: string, res: ServerResponse): LoadResult | null {
  try {
    return loadEntries(transcriptPath, sessionId)
  } catch (error) {
    sendError(res, 500, `Failed to read transcript: ${String(error)}`)
    return null
  }
}

/** @riviere-role web-tbc */
export function handleGetTranscript(
  deps: TranscriptHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (sessionId === undefined || sessionId.length === 0) {
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
    const loaded = tryLoadEntries(transcriptPath, sessionId, res)
    if (loaded === null) return
    if (loaded.status === 'unsupported') {
      sendError(res, 422, `Unsupported transcript format: ${transcriptPath}`)
      return
    }
    sendJson(res, 200, buildResponseBody(transcriptPath, loaded.entries, readFileStats(transcriptPath)))
  }
}
