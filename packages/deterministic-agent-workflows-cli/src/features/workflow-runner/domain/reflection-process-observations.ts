import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { StoredEvent } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { openSqliteDatabase } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type {
  ReflectionProcess,
  StatePeriod,
} from './reflection-process-types'

type ToolCall = {
  readonly name: string
  readonly timestampMs: number
}

const jsonlToolUseSchema = z.object({
  type: z.literal('tool_use'),
  name: z.string(),
})

const jsonlAssistantSchema = z.object({
  type: z.literal('assistant'),
  timestamp: z.string().optional(),
  message: z.object({ content: z.array(z.unknown()).optional() }).optional(),
})

const opencodeActivityRowSchema = z.object({
  m_time: z.number().nullable(),
  p_time: z.number().nullable(),
  part_data: z.string(),
})

const opencodeToolPartSchema = z.object({
  type: z.literal('tool'),
  tool: z.string(),
})

function parseTs(raw: string | undefined): number {
  if (typeof raw !== 'string') return 0
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? 0 : parsed
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function collectToolUses(content: ReadonlyArray<unknown>, timestampMs: number): ReadonlyArray<ToolCall> {
  const results: Array<ToolCall> = []
  for (const block of content) {
    const parsed = jsonlToolUseSchema.safeParse(block)
    if (parsed.success) {
      results.push({
        name: parsed.data.name,
        timestampMs,
      })
    }
  }
  return results
}

function extractToolCallsFromJsonl(path: string): ReadonlyArray<ToolCall> {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)
  return lines.flatMap((line) => {
    const parsed = jsonlAssistantSchema.safeParse(safeParseJson(line))
    if (!parsed.success) return []
    return collectToolUses(parsed.data.message?.content ?? [], parseTs(parsed.data.timestamp))
  })
}

function extractOpencodeToolCall(row: unknown): ToolCall | null {
  const parsedRow = opencodeActivityRowSchema.safeParse(row)
  if (!parsedRow.success) return null
  const parsedPart = opencodeToolPartSchema.safeParse(safeParseJson(parsedRow.data.part_data))
  if (!parsedPart.success) return null
  return {
    name: parsedPart.data.tool,
    timestampMs: parsedRow.data.p_time ?? parsedRow.data.m_time ?? 0,
  }
}

function extractToolCallsFromOpencode(path: string, sessionId: string): ReadonlyArray<ToolCall> {
  const db = openSqliteDatabase(path, { readonly: true })
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
      if (call !== null) calls.push(call)
    }
    return calls
  } finally {
    db.close()
  }
}

function readToolCalls(transcriptPath: string | undefined, sessionId: string): ReadonlyArray<ToolCall> {
  if (transcriptPath === undefined || transcriptPath.length === 0) return []
  try {
    if (transcriptPath.endsWith('.jsonl')) return extractToolCallsFromJsonl(transcriptPath)
    if (transcriptPath.endsWith('.db')) return extractToolCallsFromOpencode(transcriptPath, sessionId)
    return []
  } catch {
    return []
  }
}

/** @riviere-role domain-service */
export function computeStatePeriods(events: readonly StoredEvent[], currentState: string): ReadonlyArray<StatePeriod> {
  if (events.length === 0) return []
  const firstEvent = events[0]
  const lastEvent = events[events.length - 1]
  const startEvent = events.find((event) => event.envelope.type === 'session-started') ?? firstEvent
  const startStateRaw = startEvent.payload['currentState']
  const initialState = typeof startStateRaw === 'string' && startStateRaw.length > 0 ? startStateRaw : currentState

  const aggregated = events.reduce<{
    readonly state: string
    readonly startedAt: string
    readonly periods: ReadonlyArray<StatePeriod>
  }>((accumulator, event) => {
    if (event.envelope.type !== 'transitioned') return accumulator
    const nextState = event.payload['to']
    if (typeof nextState !== 'string' || nextState.length === 0) return accumulator
    const endedAt = event.envelope.at
    return {
      state: nextState,
      startedAt: endedAt,
      periods: [...accumulator.periods, {
        state: accumulator.state,
        startedAt: accumulator.startedAt,
        endedAt,
        durationMs: Math.max(parseTs(endedAt) - parseTs(accumulator.startedAt), 0),
      }],
    }
  }, {
    state: initialState,
    startedAt: startEvent.envelope.at,
    periods: [],
  })

  return [...aggregated.periods, {
    state: aggregated.state,
    startedAt: aggregated.startedAt,
    endedAt: lastEvent.envelope.at,
    durationMs: Math.max(parseTs(lastEvent.envelope.at) - parseTs(aggregated.startedAt), 0),
  }]
}

/** @riviere-role domain-service */
export function buildObservedEventTypes(events: readonly StoredEvent[]): ReflectionProcess['workflow']['observedEventTypes'] {
  const counts = new Map<string, number>()
  const payloadKeys = new Map<string, Set<string>>()
  for (const event of events) {
    counts.set(event.envelope.type, (counts.get(event.envelope.type) ?? 0) + 1)
    const keys = payloadKeys.get(event.envelope.type) ?? new Set<string>()
    for (const key of Object.keys(event.payload)) keys.add(key)
    payloadKeys.set(event.envelope.type, keys)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({
      type,
      count,
      payloadKeys: [...(payloadKeys.get(type) ?? new Set<string>())].sort((a, b) => a.localeCompare(b)),
    }))
}

/** @riviere-role domain-service */
export function buildStateDurationSummary(periods: readonly StatePeriod[]): ReflectionProcess['observations']['stateDurations'] {
  const totalDurationMs = periods.reduce((sum, period) => sum + period.durationMs, 0)
  const byState = periods.reduce<Map<string, {
    durationMs: number;
    entryCount: number;
  }>>((map, period) => {
    const current = map.get(period.state) ?? {
      durationMs: 0,
      entryCount: 0,
    }
    map.set(period.state, {
      durationMs: current.durationMs + period.durationMs,
      entryCount: current.entryCount + 1,
    })
    return map
  }, new Map())

  return {
    totalDurationMs,
    states: [...byState.entries()]
      .map(([state, value]) => ({
        state,
        durationMs: value.durationMs,
        percentageOfSession: totalDurationMs === 0 ? 0 : Math.round((value.durationMs / totalDurationMs) * 1000) / 10,
        entryCount: value.entryCount,
      }))
      .sort((a, b) => b.durationMs - a.durationMs || a.state.localeCompare(b.state)),
  }
}

/** @riviere-role domain-service */
export function buildTransitionSummary(events: readonly StoredEvent[]): ReflectionProcess['observations']['transitions'] {
  const transitions = events.flatMap((event) => {
    if (event.envelope.type !== 'transitioned') return []
    const from = event.payload['from']
    const to = event.payload['to']
    return typeof from === 'string' && typeof to === 'string'
      ? [{
        from,
        to,
      }]
      : []
  })

  const counts = transitions.reduce<Map<string, number>>((map, transition) => {
    const key = `${transition.from}\u0000${transition.to}`
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map())

  const repeatedPathCounts = transitions.slice(0, -1).reduce<Map<string, number>>((map, transition, index) => {
    const next = transitions.at(index + 1)
    if (next === undefined) return map
    const key = [transition.from, transition.to, next.to].join('\u0000')
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map())

  return {
    transitions: [...counts.entries()]
      .map(([key, count]) => {
        const parts = key.split('\u0000')
        const from = parts[0]
        const to = parts[1]
        return {
          from: typeof from === 'string' ? from : '',
          to: typeof to === 'string' ? to : '',
          count,
        }
      })
      .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    repeatedPaths: [...repeatedPathCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({
        path: key.split('\u0000'),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.path.join('>').localeCompare(b.path.join('>'))),
  }
}

/** @riviere-role domain-service */
export function buildDenialSummary(events: readonly StoredEvent[]): ReflectionProcess['observations']['denials'] {
  const byType = {
    write: 0,
    bash: 0,
    pluginRead: 0,
    idle: 0,
  }
  const byState = new Map<string, number>()
  const denialTypes = new Map<string, keyof typeof byType>([
    ['write-checked', 'write'],
    ['bash-checked', 'bash'],
    ['plugin-read-checked', 'pluginRead'],
    ['idle-checked', 'idle'],
  ])
  for (const event of events) {
    const key = denialTypes.get(event.envelope.type)
    if (key === undefined || event.payload['allowed'] !== false) continue
    byType[key] += 1
    const state = event.envelope.state ?? 'unknown'
    byState.set(state, (byState.get(state) ?? 0) + 1)
  }

  return {
    total: byType.write + byType.bash + byType.pluginRead + byType.idle,
    byType,
    byState: [...byState.entries()]
      .map(([state, count]) => ({
        state,
        count,
      }))
      .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state)),
  }
}

function buildCounts(calls: readonly ToolCall[], startedAtMs: number, endedAtMs: number): {
  readonly totalToolCalls: number
  readonly toolCounts: Map<string, number>
} {
  return calls.reduce<{
    totalToolCalls: number;
    toolCounts: Map<string, number>;
  }>((accumulator, call) => {
    if (call.timestampMs < startedAtMs || call.timestampMs > endedAtMs) return accumulator
    accumulator.toolCounts.set(call.name, (accumulator.toolCounts.get(call.name) ?? 0) + 1)
    return {
      totalToolCalls: accumulator.totalToolCalls + 1,
      toolCounts: accumulator.toolCounts,
    }
  }, {
    totalToolCalls: 0,
    toolCounts: new Map<string, number>(),
  })
}

function bucketToolCallsByState(calls: readonly ToolCall[], periods: readonly StatePeriod[]): ReflectionProcess['observations']['tools']['byState'] {
  return periods.map((period) => {
    const counts = buildCounts(calls, parseTs(period.startedAt), parseTs(period.endedAt))
    return {
      state: period.state,
      totalToolCalls: counts.totalToolCalls,
      toolCounts: [...counts.toolCounts.entries()]
        .map(([name, count]) => ({
          name,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }
  })
}

/** @riviere-role domain-service */
export function buildToolSummary(transcriptPath: string | undefined, sessionId: string, periods: readonly StatePeriod[]): ReflectionProcess['observations']['tools'] {
  const calls = readToolCalls(transcriptPath, sessionId)
  return {
    usedToolNames: [...new Set(calls.map((call) => call.name))].sort((a, b) => a.localeCompare(b)),
    byState: bucketToolCallsByState(calls, periods),
  }
}
