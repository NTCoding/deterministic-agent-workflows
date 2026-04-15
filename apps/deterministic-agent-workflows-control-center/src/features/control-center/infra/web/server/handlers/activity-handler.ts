import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import { getTranscriptPath, getSessionEvents } from '../../../../domain/query/session-queries'
import { projectSession } from '../../../../domain/analytics/session-projector'
import type { RouteParams } from '../router'
import { sendJson, sendError } from '../router'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'

export type ActivityHandlerDeps = {
  readonly queryDeps: SessionQueryDeps
}

type ToolCall = {
  readonly name: string
  readonly input: Record<string, unknown>
  readonly timestampMs: number
}

type StatePeriod = {
  readonly state: string
  readonly startedAtMs: number
  readonly endedAtMs: number
}

export type FileActivity = { readonly path: string; readonly count: number }
export type BashCommand = { readonly command: string; readonly count: number }
export type SearchQuery = { readonly pattern: string; readonly count: number }
export type TaskDelegation = { readonly subagent: string; readonly description: string }
export type WebHit = { readonly url: string; readonly count: number }

export type ActivityReport = {
  readonly totalToolCalls: number
  readonly toolCounts: Record<string, number>
  readonly bashCommands: ReadonlyArray<BashCommand>
  readonly bashTotal: number
  readonly filesRead: ReadonlyArray<FileActivity>
  readonly filesEdited: ReadonlyArray<FileActivity>
  readonly filesWritten: ReadonlyArray<FileActivity>
  readonly filesTouchedTotal: number
  readonly grepSearches: ReadonlyArray<SearchQuery>
  readonly globSearches: ReadonlyArray<SearchQuery>
  readonly tasksDelegated: ReadonlyArray<TaskDelegation>
  readonly webFetches: ReadonlyArray<WebHit>
  readonly webSearches: ReadonlyArray<WebHit>
}

export type PerStateActivity = {
  readonly state: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly report: ActivityReport
}

export type ActivityResponse = {
  readonly overall: ActivityReport
  readonly byState: ReadonlyArray<PerStateActivity>
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function inc<K extends string>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function topN(map: Map<string, number>, n: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function normaliseBash(cmd: string): string {
  return cmd.replace(/\s+/g, ' ').trim()
}

function parseTs(v: unknown): number {
  if (typeof v !== 'string') return 0
  const n = Date.parse(v)
  return Number.isNaN(n) ? 0 : n
}

function extractToolCallsFromJsonl(path: string): ToolCall[] {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const calls: ToolCall[] = []
  for (const line of lines) {
    let obj: unknown
    try { obj = JSON.parse(line) } catch { continue }
    if (typeof obj !== 'object' || obj === null) continue
    const entry = obj as Record<string, unknown>
    if (entry['type'] !== 'assistant') continue
    const ts = parseTs(entry['timestamp'])
    const msg = entry['message'] as Record<string, unknown> | undefined
    if (!msg) continue
    const content = msg['content']
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (typeof b !== 'object' || b === null) continue
      const block = b as Record<string, unknown>
      if (block['type'] !== 'tool_use') continue
      const name = str(block['name'])
      const input = (typeof block['input'] === 'object' && block['input'] !== null)
        ? block['input'] as Record<string, unknown>
        : {}
      if (name) calls.push({ name, input, timestampMs: ts })
    }
  }
  return calls
}

function extractToolCallsFromOpencode(dbPath: string, sessionId: string): ToolCall[] {
  try {
    const db = openSqliteDatabase(dbPath, { readonly: true })
    try {
      const rows = db.prepare(`
        SELECT m.time_created as m_time, p.time_created as p_time, p.data as part_data
        FROM message m
        JOIN part p ON p.message_id = m.id
        WHERE m.session_id = ?
        ORDER BY m.time_created ASC, p.time_created ASC
      `).all(sessionId) as unknown[]
      const calls: ToolCall[] = []
      for (const row of rows) {
        const r = row as Record<string, unknown>
        const pTime = typeof r['p_time'] === 'number' ? r['p_time'] as number : 0
        const mTime = typeof r['m_time'] === 'number' ? r['m_time'] as number : 0
        const ts = pTime || mTime
        const raw = typeof r['part_data'] === 'string' ? r['part_data'] as string : ''
        let partObj: unknown
        try { partObj = JSON.parse(raw) } catch { continue }
        if (typeof partObj !== 'object' || partObj === null) continue
        const p = partObj as Record<string, unknown>
        if (p['type'] !== 'tool') continue
        const name = str(p['tool'])
        const state = typeof p['state'] === 'object' && p['state'] !== null ? p['state'] as Record<string, unknown> : {}
        const input = typeof state['input'] === 'object' && state['input'] !== null
          ? state['input'] as Record<string, unknown>
          : {}
        if (name) calls.push({ name, input, timestampMs: ts })
      }
      return calls
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

function lowerName(n: string): string { return n.toLowerCase() }
function isBashTool(n: string): boolean { return lowerName(n) === 'bash' }
function isReadTool(n: string): boolean { return lowerName(n) === 'read' }
function isEditTool(n: string): boolean { const l = lowerName(n); return l === 'edit' || l === 'multiedit' || l === 'apply_patch' }
function isWriteTool(n: string): boolean { return lowerName(n) === 'write' }
function isGrepTool(n: string): boolean { return lowerName(n) === 'grep' }
function isGlobTool(n: string): boolean { return lowerName(n) === 'glob' }
function isTaskTool(n: string): boolean { const l = lowerName(n); return l === 'task' || l === 'agent' }
function isWebFetchTool(n: string): boolean { return lowerName(n) === 'webfetch' }
function isWebSearchTool(n: string): boolean { return lowerName(n) === 'websearch' }

function extractFilePathsFromPatchInput(input: Record<string, unknown>): string[] {
  const explicit = str(input['file_path']) || str(input['filePath']) || str(input['path'])
  if (explicit) return [explicit]
  const patch = str(input['patchText']) || str(input['patch']) || str(input['input']) || ''
  if (!patch) return []
  const out: string[] = []
  const re = /\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(\S+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(patch)) !== null) {
    if (typeof m[1] === 'string') out.push(m[1])
  }
  return out
}

function buildActivityReport(calls: ReadonlyArray<ToolCall>): ActivityReport {
  const toolCounts = new Map<string, number>()
  const bashCounts = new Map<string, number>()
  const filesRead = new Map<string, number>()
  const filesEdited = new Map<string, number>()
  const filesWritten = new Map<string, number>()
  const grepCounts = new Map<string, number>()
  const globCounts = new Map<string, number>()
  const tasks: TaskDelegation[] = []
  const webFetch = new Map<string, number>()
  const webSearch = new Map<string, number>()

  for (const c of calls) {
    inc(toolCounts, c.name)
    const input = c.input
    if (isBashTool(c.name)) {
      const cmd = normaliseBash(str(input['command']))
      if (cmd) inc(bashCounts, cmd)
    } else if (isReadTool(c.name)) {
      const p = str(input['file_path']) || str(input['filePath']) || str(input['path'])
      if (p) inc(filesRead, p)
    } else if (isEditTool(c.name)) {
      for (const p of extractFilePathsFromPatchInput(input)) inc(filesEdited, p)
    } else if (isWriteTool(c.name)) {
      const p = str(input['file_path']) || str(input['filePath']) || str(input['path'])
      if (p) inc(filesWritten, p)
    } else if (isGrepTool(c.name)) {
      const q = str(input['pattern'])
      if (q) inc(grepCounts, q)
    } else if (isGlobTool(c.name)) {
      const q = str(input['pattern'])
      if (q) inc(globCounts, q)
    } else if (isTaskTool(c.name)) {
      const subagent = str(input['subagent_type']) || str(input['type']) || 'agent'
      const description = str(input['description']) || str(input['prompt']).slice(0, 120) || ''
      tasks.push({ subagent, description })
    } else if (isWebFetchTool(c.name)) {
      const u = str(input['url'])
      if (u) inc(webFetch, u)
    } else if (isWebSearchTool(c.name)) {
      const q = str(input['query'])
      if (q) inc(webSearch, q)
    }
  }

  const toArr = (m: Map<string, number>, n: number): Array<FileActivity> =>
    topN(m, n).map(([path, count]) => ({ path, count }))

  return {
    totalToolCalls: calls.length,
    toolCounts: Object.fromEntries(toolCounts.entries()),
    bashCommands: topN(bashCounts, 15).map(([command, count]) => ({ command, count })),
    bashTotal: [...bashCounts.values()].reduce((a, b) => a + b, 0),
    filesRead: toArr(filesRead, 20),
    filesEdited: toArr(filesEdited, 20),
    filesWritten: toArr(filesWritten, 20),
    filesTouchedTotal: new Set<string>([...filesRead.keys(), ...filesEdited.keys(), ...filesWritten.keys()]).size,
    grepSearches: topN(grepCounts, 12).map(([pattern, count]) => ({ pattern, count })),
    globSearches: topN(globCounts, 12).map(([pattern, count]) => ({ pattern, count })),
    tasksDelegated: tasks.slice(0, 30),
    webFetches: topN(webFetch, 15).map(([url, count]) => ({ url, count })),
    webSearches: topN(webSearch, 15).map(([url, count]) => ({ url, count })),
  }
}

function loadStatePeriods(deps: SessionQueryDeps, sessionId: string): Array<{ state: string; startedAt: string; endedAt?: string | undefined; startedAtMs: number; endedAtMs: number }> {
  const events = getSessionEvents(deps, sessionId)
  if (events.length === 0) return []
  const projection = projectSession(sessionId, events)
  return projection.statePeriods.map((p) => ({
    state: p.state,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    startedAtMs: parseTs(p.startedAt),
    endedAtMs: p.endedAt ? parseTs(p.endedAt) : Number.POSITIVE_INFINITY,
  }))
}

const UNASSIGNED_IDX = -1

function bucketCallsByState(calls: ReadonlyArray<ToolCall>, periods: ReadonlyArray<StatePeriod>): Map<number, ToolCall[]> {
  const buckets = new Map<number, ToolCall[]>()
  buckets.set(UNASSIGNED_IDX, [])
  for (let i = 0; i < periods.length; i++) buckets.set(i, [])
  for (const c of calls) {
    let assigned = false
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i]
      if (!p) continue
      if (c.timestampMs >= p.startedAtMs && c.timestampMs <= p.endedAtMs) {
        const arr = buckets.get(i)
        if (arr) arr.push(c)
        assigned = true
        break
      }
    }
    if (!assigned) buckets.get(UNASSIGNED_IDX)?.push(c)
  }
  return buckets
}

export function handleGetSessionActivity(
  deps: ActivityHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (!sessionId) { sendError(res, 400, 'Missing session ID'); return }

    const transcriptPath = getTranscriptPath(deps.queryDeps, sessionId)
    let calls: ToolCall[] = []
    if (transcriptPath && existsSync(transcriptPath)) {
      if (transcriptPath.endsWith('.jsonl')) {
        calls = extractToolCallsFromJsonl(transcriptPath)
      } else if (transcriptPath.endsWith('.db')) {
        calls = extractToolCallsFromOpencode(transcriptPath, sessionId)
      }
    }

    const periodsRaw = loadStatePeriods(deps.queryDeps, sessionId)
    const periods: StatePeriod[] = periodsRaw.map(p => ({ state: p.state, startedAtMs: p.startedAtMs, endedAtMs: p.endedAtMs }))
    const buckets = bucketCallsByState(calls, periods)

    const byState: PerStateActivity[] = []
    const unassignedCalls = buckets.get(UNASSIGNED_IDX) ?? []
    if (unassignedCalls.length > 0) {
      const firstTs = unassignedCalls[0]?.timestampMs ?? 0
      const lastTs = unassignedCalls[unassignedCalls.length - 1]?.timestampMs ?? firstTs
      byState.push({
        state: 'PRE-WORKFLOW',
        startedAt: firstTs > 0 ? new Date(firstTs).toISOString() : '',
        endedAt: lastTs > 0 ? new Date(lastTs).toISOString() : null,
        report: buildActivityReport(unassignedCalls),
      })
    }
    for (let i = 0; i < periodsRaw.length; i++) {
      const p = periodsRaw[i]
      if (!p) continue
      byState.push({
        state: p.state,
        startedAt: p.startedAt,
        endedAt: p.endedAt ?? null,
        report: buildActivityReport(buckets.get(i) ?? []),
      })
    }

    const response: ActivityResponse = {
      overall: buildActivityReport(calls),
      byState,
    }
    sendJson(res, 200, response)
  }
}
