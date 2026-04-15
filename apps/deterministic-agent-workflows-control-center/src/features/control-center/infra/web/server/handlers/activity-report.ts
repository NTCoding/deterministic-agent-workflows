import type {
  ActivityReport,
  BashCommand,
  FileActivity,
  SearchQuery,
  TaskDelegation,
  ToolCall,
  WebHit,
} from './activity-types'
import {
  inc, str, topN 
} from './activity-types'

const EDIT_TOOLS = new Set(['edit', 'multiedit', 'apply_patch'])
const TASK_TOOLS = new Set(['task', 'agent'])

function normaliseBash(cmd: string): string {
  return cmd.replaceAll(/\s+/g, ' ').trim()
}

function firstPath(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'filePath', 'path']) {
    const value = str(input[key])
    if (value.length > 0) return value
  }
  return ''
}

function extractPatchFilePaths(patch: string): ReadonlyArray<string> {
  const re = /\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(\S+)/gi
  const matches = [...patch.matchAll(re)]
  return matches.flatMap(m => typeof m[1] === 'string' ? [m[1]] : [])
}

function extractFilePathsFromPatchInput(input: Record<string, unknown>): ReadonlyArray<string> {
  const explicit = firstPath(input)
  if (explicit.length > 0) return [explicit]
  const patch = str(input['patchText']) || str(input['patch']) || str(input['input'])
  return patch.length === 0 ? [] : extractPatchFilePaths(patch)
}

type Counters = {
  readonly toolCounts: Map<string, number>
  readonly bashCounts: Map<string, number>
  readonly filesRead: Map<string, number>
  readonly filesEdited: Map<string, number>
  readonly filesWritten: Map<string, number>
  readonly grepCounts: Map<string, number>
  readonly globCounts: Map<string, number>
  readonly tasks: Array<TaskDelegation>
  readonly webFetch: Map<string, number>
  readonly webSearch: Map<string, number>
}

function newCounters(): Counters {
  return {
    toolCounts: new Map(),
    bashCounts: new Map(),
    filesRead: new Map(),
    filesEdited: new Map(),
    filesWritten: new Map(),
    grepCounts: new Map(),
    globCounts: new Map(),
    tasks: [],
    webFetch: new Map(),
    webSearch: new Map(),
  }
}

function applyBash(c: Counters, input: Record<string, unknown>): void {
  const cmd = normaliseBash(str(input['command']))
  if (cmd.length > 0) inc(c.bashCounts, cmd)
}

function applyPath(map: Map<string, number>, input: Record<string, unknown>): void {
  const p = firstPath(input)
  if (p.length > 0) inc(map, p)
}

function applyEdit(c: Counters, input: Record<string, unknown>): void {
  for (const p of extractFilePathsFromPatchInput(input)) inc(c.filesEdited, p)
}

function applySearch(map: Map<string, number>, input: Record<string, unknown>): void {
  const q = str(input['pattern'])
  if (q.length > 0) inc(map, q)
}

function applyTask(c: Counters, input: Record<string, unknown>): void {
  const subagent = str(input['subagent_type']) || str(input['type']) || 'agent'
  const description = str(input['description']) || str(input['prompt']).slice(0, 120)
  c.tasks.push({
    subagent,
    description,
  })
}

function applyUrl(map: Map<string, number>, key: 'url' | 'query', input: Record<string, unknown>): void {
  const value = str(input[key])
  if (value.length > 0) inc(map, value)
}

function applyCall(c: Counters, call: ToolCall): void {
  inc(c.toolCounts, call.name)
  const lower = call.name.toLowerCase()
  const input = call.input
  if (lower === 'bash') applyBash(c, input)
  else if (lower === 'read') applyPath(c.filesRead, input)
  else if (EDIT_TOOLS.has(lower)) applyEdit(c, input)
  else if (lower === 'write') applyPath(c.filesWritten, input)
  else if (lower === 'grep') applySearch(c.grepCounts, input)
  else if (lower === 'glob') applySearch(c.globCounts, input)
  else if (TASK_TOOLS.has(lower)) applyTask(c, input)
  else if (lower === 'webfetch') applyUrl(c.webFetch, 'url', input)
  else if (lower === 'websearch') applyUrl(c.webSearch, 'query', input)
}

function toFileActivities(map: Map<string, number>, n: number): ReadonlyArray<FileActivity> {
  return topN(map, n).map(([path, count]) => ({
    path,
    count,
  }))
}

function toSearchQueries(map: Map<string, number>, n: number): ReadonlyArray<SearchQuery> {
  return topN(map, n).map(([pattern, count]) => ({
    pattern,
    count,
  }))
}

function toWebHits(map: Map<string, number>, n: number): ReadonlyArray<WebHit> {
  return topN(map, n).map(([url, count]) => ({
    url,
    count,
  }))
}

function toBashCommands(map: Map<string, number>, n: number): ReadonlyArray<BashCommand> {
  return topN(map, n).map(([command, count]) => ({
    command,
    count,
  }))
}

/** @riviere-role web-tbc */
export function buildActivityReport(calls: ReadonlyArray<ToolCall>): ActivityReport {
  const c = newCounters()
  for (const call of calls) applyCall(c, call)
  return {
    totalToolCalls: calls.length,
    toolCounts: Object.fromEntries(c.toolCounts.entries()),
    bashCommands: toBashCommands(c.bashCounts, 15),
    bashTotal: [...c.bashCounts.values()].reduce((a, b) => a + b, 0),
    filesRead: toFileActivities(c.filesRead, 20),
    filesEdited: toFileActivities(c.filesEdited, 20),
    filesWritten: toFileActivities(c.filesWritten, 20),
    filesTouchedTotal: new Set<string>([...c.filesRead.keys(), ...c.filesEdited.keys(), ...c.filesWritten.keys()]).size,
    grepSearches: toSearchQueries(c.grepCounts, 12),
    globSearches: toSearchQueries(c.globCounts, 12),
    tasksDelegated: c.tasks.slice(0, 30),
    webFetches: toWebHits(c.webFetch, 15),
    webSearches: toWebHits(c.webSearch, 15),
  }
}
