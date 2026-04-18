/** @riviere-role web-tbc */
export type StatePeriod = {
  readonly state: string;
  readonly startedAt: string;
  readonly endedAt?: string | undefined
}

/** @riviere-role web-tbc */
export type JournalEntry = {
  readonly agentName: string;
  readonly content: string;
  readonly at: string;
  readonly state: string
}

/** @riviere-role web-tbc */
export type InsightEntry = {
  readonly severity: string;
  readonly title: string;
  readonly evidence: string
}

const STATE_PALETTE: ReadonlyArray<string> = [
  's-dev', 's-review', 's-commit', 's-pr', 's-feedback',
  's-spawn', 's-cr', 's-respawn', 's-done', 's-plan',
]

function hashState(state: string): number {
  const seed = { hash: 0 }
  for (const ch of state) {
    seed.hash = (Math.imul(seed.hash, 31) + ch.charCodeAt(0)) | 0
  }
  return Math.abs(seed.hash)
}

/** @riviere-role web-tbc */
export function stateCssClass(state: string): string {
  return STATE_PALETTE[hashState(state) % STATE_PALETTE.length] ?? 's-idle'
}

/** @riviere-role web-tbc */
export function stateForTimestamp(periods: ReadonlyArray<StatePeriod>, iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const match = periods.find(p => {
    const start = Date.parse(p.startedAt)
    const end = p.endedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(p.endedAt)
    return t >= start && t <= end
  })
  return match === undefined ? null : match.state
}

/** @riviere-role web-tbc */
export function formatTime(iso: string): string {
  return iso.length > 0 ? iso.slice(11, 19) : ''
}

/** @riviere-role web-tbc */
export function formatDate(iso: string): string {
  return iso.length > 0 ? iso.slice(0, 10) : ''
}

/** @riviere-role web-tbc */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** @riviere-role web-tbc */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** @riviere-role web-tbc */
export function shortModel(model: string | undefined): string {
  if (model === undefined) return ''
  const parts = model.replace(/^claude-/, '').split('-')
  return parts.slice(0, 3).join('-')
}

/** @riviere-role web-tbc */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

const idCounter = { n: 0 }
/** @riviere-role web-tbc */
export function nextId(prefix: string): string {
  idCounter.n += 1
  return `${prefix}-${idCounter.n}`
}

/** @riviere-role web-tbc */
export function strOrEmpty(value: string | null | undefined): string {
  if (value === null) return ''
  if (value === undefined) return ''
  return value
}

/** @riviere-role web-tbc */
export function lowerOrEmpty(value: string | null | undefined): string {
  if (value === null) return ''
  if (value === undefined) return ''
  return value.toLowerCase()
}

/** @riviere-role web-tbc */
export function trimOrEmpty(value: string | null | undefined): string {
  if (value === null) return ''
  if (value === undefined) return ''
  return value.trim()
}
