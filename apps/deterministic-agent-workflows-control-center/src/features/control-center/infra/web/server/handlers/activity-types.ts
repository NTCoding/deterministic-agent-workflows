/** @riviere-role web-tbc */
export type FileActivity = {
  readonly path: string;
  readonly count: number
}
/** @riviere-role web-tbc */
export type BashCommand = {
  readonly command: string;
  readonly count: number
}
/** @riviere-role web-tbc */
export type FailedCommand = {
  readonly toolName: string;
  readonly command: string;
  readonly output: string;
  readonly count: number
}
/** @riviere-role web-tbc */
export type SearchQuery = {
  readonly pattern: string;
  readonly count: number
}
/** @riviere-role web-tbc */
export type TaskDelegation = {
  readonly subagent: string;
  readonly description: string
}
/** @riviere-role web-tbc */
export type WebHit = {
  readonly url: string;
  readonly count: number
}

/** @riviere-role web-tbc */
export type ActivityReport = {
  readonly totalToolCalls: number
  readonly toolCounts: Record<string, number>
  readonly bashCommands: ReadonlyArray<BashCommand>
  readonly bashTotal: number
  readonly workflowCommands: ReadonlyArray<BashCommand>
  readonly failedCommands: ReadonlyArray<FailedCommand>
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

/** @riviere-role web-tbc */
export type PerStateActivity = {
  readonly state: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly report: ActivityReport
}

/** @riviere-role web-tbc */
export type ActivityResponse = {
  readonly overall: ActivityReport
  readonly byState: ReadonlyArray<PerStateActivity>
}

/** @riviere-role web-tbc */
export type ToolCall = {
  readonly id?: string | undefined
  readonly name: string
  readonly input: Record<string, unknown>
  readonly timestampMs: number
  readonly output?: string | undefined
  readonly isError?: boolean | undefined
}

/** @riviere-role web-tbc */
export function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** @riviere-role web-tbc */
export function inc<K extends string>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** @riviere-role web-tbc */
export function topN(map: Map<string, number>, n: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

/** @riviere-role web-tbc */
export function parseTs(raw: unknown): number {
  if (typeof raw !== 'string') return 0
  const n = Date.parse(raw)
  return Number.isNaN(n) ? 0 : n
}

/** @riviere-role web-tbc */
export function safeParseJson(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return null
  }
}
