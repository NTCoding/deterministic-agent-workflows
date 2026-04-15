import type {
  TranscriptEntry,
  TranscriptContentBlock,
  TranscriptUsage,
  TranscriptResponse,
  SessionDetailDto,
} from '../api-client'
import {
  html, esc 
} from '../render'

/** @riviere-role web-tbc */
export type TranscriptContext = {readonly session?: SessionDetailDto | undefined}

type StatePeriod = {
  readonly state: string;
  readonly startedAt: string;
  readonly endedAt?: string | undefined 
}
type JournalEntry = {
  readonly agentName: string;
  readonly content: string;
  readonly at: string;
  readonly state: string 
}
type InsightEntry = {
  readonly severity: string;
  readonly title: string;
  readonly evidence: string 
}

function stateForTimestamp(periods: ReadonlyArray<StatePeriod>, iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  for (const p of periods) {
    const start = Date.parse(p.startedAt)
    const end = p.endedAt ? Date.parse(p.endedAt) : Number.POSITIVE_INFINITY
    if (t >= start && t <= end) return p.state
  }
  return null
}

function stateCssClass(state: string): string {
  const s = state.toLowerCase()
  if (s.includes('spawn')) return 's-spawn'
  if (s.includes('plan')) return 's-plan'
  if (s.includes('respawn')) return 's-respawn'
  if (s.includes('dev')) return 's-dev'
  if (s.includes('review') && !s.includes('cr')) return 's-review'
  if (s.includes('commit')) return 's-commit'
  if (s === 'cr' || s.includes('code_review')) return 's-cr'
  if (s.includes('pr')) return 's-pr'
  if (s.includes('done') || s.includes('complete')) return 's-done'
  if (s.includes('block')) return 's-blocked'
  if (s.includes('feedback')) return 's-feedback'
  return 's-idle'
}

/* ─── Pricing (USD per 1M tokens) ────────────────────────────────
   Keep this tiny table explicit; fall back to zero when unknown. */
type PriceRow = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number 
}
const MODEL_PRICES: Record<string, PriceRow> = {
  'claude-opus-4-5': {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75 
  },
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75 
  },
  'claude-sonnet-4-5': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75 
  },
  'claude-haiku-4-5': {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1 
  },
}
function priceFor(model: string | undefined): PriceRow {
  if (!model) return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0 
  }
  for (const [k, v] of Object.entries(MODEL_PRICES)) {
    if (model.includes(k)) return v
  }
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0 
  }
}
function costForUsage(u: TranscriptUsage, model: string | undefined): number {
  const p = priceFor(model)
  return (u.inputTokens * p.input + u.outputTokens * p.output +
    u.cacheReadInputTokens * p.cacheRead + u.cacheCreationInputTokens * p.cacheWrite) / 1_000_000
}

/* ─── Formatting helpers ───────────────────────────────────────── */
function formatTime(iso: string): string {
  if (!iso) return ''
  return iso.slice(11, 19)
}
function formatDate(iso: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
function shortModel(model: string | undefined): string {
  if (!model) return ''
  const parts = model.replace(/^claude-/, '').split('-')
  return parts.slice(0, 3).join('-')
}

/* ─── Role helpers ─────────────────────────────────────────────── */
function roleLabel(type: TranscriptEntry['type'], content: ReadonlyArray<TranscriptContentBlock>): string {
  if (type === 'assistant') return 'ASSISTANT'
  if (type === 'system') return 'SYSTEM'
  if (type === 'other') return 'OTHER'
  const hasOnlyToolResults = content.length > 0 && content.every(b => b.kind === 'tool_result')
  return hasOnlyToolResults ? 'TOOL RESULT' : 'USER'
}
function roleTag(type: TranscriptEntry['type'], content: ReadonlyArray<TranscriptContentBlock>): string {
  if (type === 'assistant') return '[assistant]'
  if (type === 'system') return '[system]'
  if (type === 'other') return '[other]'
  const hasOnlyToolResults = content.length > 0 && content.every(b => b.kind === 'tool_result')
  return hasOnlyToolResults ? '[tool_result]' : '[user]'
}
function roleDot(type: TranscriptEntry['type']): string {
  if (type === 'assistant') return '◆'
  if (type === 'system') return '■'
  if (type === 'other') return '○'
  return '●'
}
/* ─── Block rendering ──────────────────────────────────────────── */
function renderDiff(input: Record<string, unknown>): string {
  const oldStr = typeof input['old_string'] === 'string' ? input['old_string'] : null
  const newStr = typeof input['new_string'] === 'string' ? input['new_string'] : null
  const content = typeof input['content'] === 'string' ? input['content'] : null
  const filePath = typeof input['file_path'] === 'string' ? input['file_path'] : null

  if (oldStr !== null && newStr !== null) {
    const pathHdr = filePath ? `<div class="tr-diff-label">${esc(filePath)}</div>` : ''
    const delLines = oldStr.split('\n').map(l => `<div class="tr-diff-line del">- ${esc(l)}</div>`).join('')
    const addLines = newStr.split('\n').map(l => `<div class="tr-diff-line add">+ ${esc(l)}</div>`).join('')
    return `<div class="tr-diff">${pathHdr}${delLines}${addLines}</div>`
  }
  if (content !== null && filePath !== null) {
    const lines = content.split('\n').slice(0, 80).map(l => `<div class="tr-diff-line add">+ ${esc(l)}</div>`).join('')
    return `<div class="tr-diff"><div class="tr-diff-label">${esc(filePath)}</div>${lines}${content.split('\n').length > 80 ? '<div class="tr-diff-line" style="color:#999">… (truncated)</div>' : ''}</div>`
  }
  return ''
}

function renderToolUseBlock(id: string, name: string, input: Record<string, unknown>): string {
  const key = Object.keys(input)[0] ?? ''
  const val = key ? String(Object.values(input)[0] ?? '').slice(0, 80).replaceAll('\n', ' ') : ''
  const preview = key ? `${key}: ${val}` : ''
  const fullJson = esc(JSON.stringify(input, null, 2))
  const bodyId = `tool-${id || Math.random().toString(36).slice(2)}`
  const diffHtml = (name === 'Edit' || name === 'Write' || name === 'MultiEdit') ? renderDiff(input) : ''
  return `<div class="tr-tool" data-tool-id="${esc(id)}" data-tool-name="${esc(name)}">` +
    `<div class="tr-tool-head" data-toggle="${bodyId}" data-pair-src="${esc(id)}">` +
      `<span class="tr-tool-name">⚙ ${esc(name)}</span>` +
      (preview ? `<span class="tr-tool-preview">${esc(preview)}</span>` : `<span class="tr-tool-preview"></span>`) +
      `<span class="tr-tool-arrow">▶</span>` +
    `</div>` +
    `<pre id="${bodyId}" class="tr-tool-body">${fullJson}${diffHtml ? `\n</pre>${diffHtml}<pre class="tr-tool-body open" style="display:none">` : ''}</pre>` +
  `</div>`
}

function renderToolResultBlock(toolUseId: string, toolName: string, text: string, isError: boolean): string {
  const preview = text.slice(0, 120).replaceAll(/\s+/g, ' ')
  const bodyId = `result-${toolUseId || Math.random().toString(36).slice(2)}`
  const escaped = esc(text)
  const cls = isError ? 'tr-result tr-result-error' : 'tr-result'
  const errBadge = isError ? ` <span class="tr-chip tr-chip-error">ERROR</span>` : ''
  return `<div class="${cls}" data-tool-use-id="${esc(toolUseId)}">` +
    `<div class="tr-result-head" data-toggle="${bodyId}" data-pair-src="${esc(toolUseId)}">` +
      `<span class="tr-result-name">↩ ${esc(toolName)}${errBadge}</span>` +
      `<span class="tr-result-preview">${esc(preview)}${text.length > 120 ? '…' : ''}</span>` +
      `<span class="tr-result-arrow">▶</span>` +
    `</div>` +
    `<pre id="${bodyId}" class="tr-result-body">${escaped}</pre>` +
  `</div>`
}

function renderThinkingBlock(text: string): string {
  const id = `think-${Math.random().toString(36).slice(2)}`
  return `<div class="tr-thinking">` +
    `<div class="tr-thinking-head" data-toggle="${id}">` +
      `<span>🧠 Thinking</span>` +
      `<span class="tr-thinking-arrow">▶</span>` +
    `</div>` +
    `<div id="${id}" class="tr-thinking-body">${esc(text)}</div>` +
  `</div>`
}

function renderTextBlock(text: string): string {
  const lineCount = (text.match(/\n/g) ?? []).length + 1
  if (lineCount > 30) {
    const id = `txt-${Math.random().toString(36).slice(2)}`
    return `<div class="tr-text-collapse" id="${id}">` +
      `<div class="tr-text">${esc(text)}</div>` +
      `</div>` +
      `<button type="button" class="tr-text-expand" data-expand="${id}">Show all ${lineCount} lines</button>`
  }
  return `<div class="tr-text">${esc(text)}</div>`
}

function renderContentBlock(block: TranscriptContentBlock): string {
  if (block.kind === 'text') return renderTextBlock(block.text)
  if (block.kind === 'thinking') return renderThinkingBlock(block.text)
  if (block.kind === 'tool_use') return renderToolUseBlock(block.id, block.name, block.input)
  if (block.kind === 'tool_result') return renderToolResultBlock(block.toolUseId, block.toolName, block.text, block.isError)
  return ''
}

/* ─── Entry rendering ──────────────────────────────────────────── */
function renderEntryHeader(entry: TranscriptEntry, idx: number, state: string | null, sessionId: string | undefined): string {
  const time = formatTime(entry.timestamp)
  const date = formatDate(entry.timestamp)
  const type = entry.type
  const label = roleLabel(type, entry.content)
  const tag = roleTag(type, entry.content)
  const dot = roleDot(type)

  const chips: Array<string> = []
  if (state) chips.push(`<span class="tr-state-chip ${stateCssClass(state)}" title="state at this point">${esc(state)}</span>`)
  if (entry.model) chips.push(`<span class="tr-chip tr-chip-model">${esc(shortModel(entry.model))}</span>`)
  if (entry.stopReason && entry.stopReason !== 'end_turn') chips.push(`<span class="tr-chip tr-chip-stop">⏹ ${esc(entry.stopReason)}</span>`)
  if (entry.isSidechain) chips.push(`<span class="tr-chip tr-chip-sidechain">sidechain</span>`)
  if (entry.usage) {
    const u = entry.usage
    const cached = u.cacheReadInputTokens
    const totalIn = u.inputTokens + cached
    const hitPct = totalIn > 0 ? Math.round((cached / totalIn) * 100) : 0
    chips.push(`<span class="tr-chip tr-chip-tokens" title="input ${u.inputTokens} / output ${u.outputTokens} / cache-read ${u.cacheReadInputTokens} / cache-write ${u.cacheCreationInputTokens}">↓${formatTokens(u.inputTokens)} ↑${formatTokens(u.outputTokens)}</span>`)
    if (cached > 0) chips.push(`<span class="tr-chip tr-chip-cache" title="cache read ${u.cacheReadInputTokens} tokens">⚡ ${hitPct}% cached</span>`)
    const cost = costForUsage(u, entry.model)
    if (cost > 0) chips.push(`<span class="tr-chip tr-chip-tokens" title="cost estimate">${formatCost(cost)}</span>`)
  }

  return `<div class="tr-entry-head">` +
    `<span class="tr-role">` +
      `<span class="tr-role-dot">${dot}</span>` +
      `<span class="tr-role-label">${label}</span>` +
      `<span class="tr-role-tag">${tag}</span>` +
    `</span>` +
    chips.join('') +
    `<span class="tr-time">${esc(date)} ${esc(time)}` +
      ` <a href="#msg-${idx}" class="tr-permalink" data-permalink="${idx}" title="copy link to message">#${idx}</a>` +
      (sessionId ? ` <a href="#" class="tr-permalink tr-goto-events" data-goto-events="${esc(entry.timestamp)}" title="jump to events near this time">events →</a>` : '') +
    `</span>` +
  `</div>`
}

function renderEntry(entry: TranscriptEntry, idx: number, state: string | null, sessionId: string | undefined): string {
  const type = entry.type
  const cls = type === 'assistant' ? 'tr-assistant'
    : type === 'user' ? 'tr-user'
      : type === 'system' ? 'tr-system'
        : 'tr-other'
  const sidechainCls = entry.isSidechain ? ' tr-sidechain' : ''
  const contentHtml = entry.content.map(renderContentBlock).join('')
  const toolNamesInEntry = entry.content.flatMap(b => b.kind === 'tool_use' ? [b.name] : []).join(' ')
  const hasError = entry.content.some(b => b.kind === 'tool_result' && b.isError) ? '1' : '0'

  return `<div id="msg-${idx}" class="tr-entry ${cls}${sidechainCls}" data-idx="${idx}" data-role="${type}" data-tools="${esc(toolNamesInEntry)}" data-has-error="${hasError}" data-tokens="${entry.usage ? entry.usage.inputTokens + entry.usage.outputTokens : 0}" data-sidechain="${entry.isSidechain ? '1' : '0'}" data-state="${esc(state ?? '')}" data-ts="${esc(entry.timestamp)}">` +
    renderEntryHeader(entry, idx, state, sessionId) +
    `<div class="tr-entry-body">${contentHtml || '<div class="tr-text" style="color:#95a5a6;font-style:italic">(no content)</div>'}</div>` +
  `</div>`
}

function renderJournalAnnot(j: JournalEntry): string {
  return `<div class="tr-journal-annot" data-ts="${esc(j.at)}">` +
    `<span class="tr-ja-agent">📓 ${esc(j.agentName)}</span>` +
    `<span style="font-family:monospace;font-size:10px;color:#7f8c8d">${esc(formatTime(j.at))}${j.state ? ` · ${esc(j.state)}` : ''}</span>` +
    `<div style="margin-top:4px;white-space:pre-wrap">${esc(j.content)}</div>` +
  `</div>`
}

function renderInsightAnnot(ins: InsightEntry): string {
  const icon = ins.severity === 'warning' ? '⚠' : ins.severity === 'success' ? '✓' : 'ℹ'
  return `<div class="tr-insight-annot">` +
    `<strong>${icon} ${esc(ins.title)}</strong>` +
    (ins.evidence ? `<div style="margin-top:4px">${esc(ins.evidence)}</div>` : '') +
  `</div>`
}

/* ─── Minimap / State Outline ──────────────────────────────────── */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), rs = s % 60
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60), rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

function firstEntryIdxInRange(entries: ReadonlyArray<TranscriptEntry>, startMs: number, endMs: number): number {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t) && t >= startMs && t <= endMs) return i
  }
  return -1
}

function countEntriesInRange(entries: ReadonlyArray<TranscriptEntry>, startMs: number, endMs: number): number {
  let n = 0
  for (const e of entries) {
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t) && t >= startMs && t <= endMs) n++
  }
  return n
}

function renderMinimap(entries: ReadonlyArray<TranscriptEntry>, periods: ReadonlyArray<StatePeriod>): string {
  if (periods.length === 0) {
    return `<aside class="tr-minimap">` +
      `<div class="tr-minimap-head">Outline</div>` +
      `<div style="padding:12px;color:#95a5a6;font-size:11px;font-style:italic">No state transitions recorded for this session.</div>` +
    `</aside>`
  }

  const rows: Array<string> = []
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]
    if (!p) continue
    const startMs = Date.parse(p.startedAt)
    const endMs = p.endedAt ? Date.parse(p.endedAt) : Number.POSITIVE_INFINITY
    const firstIdx = firstEntryIdxInRange(entries, startMs, endMs)
    const msgCount = countEntriesInRange(entries, startMs, endMs)
    const durationMs = (p.endedAt ? Date.parse(p.endedAt) : Date.now()) - startMs
    const clickable = firstIdx >= 0
    const targetAttr = clickable ? ` href="#msg-${firstIdx}" data-mm-idx="${firstIdx}"` : ' data-mm-idx=""'
    rows.push(
      `<a class="tr-mm-transition${clickable ? '' : ' tr-mm-empty'}"${targetAttr}>` +
        `<span class="tr-mm-trans-main">` +
          `<span class="tr-state-chip ${stateCssClass(p.state)}">${esc(p.state)}</span>` +
          `<span class="tr-mm-trans-time">${esc(formatTime(p.startedAt))}</span>` +
        `</span>` +
        `<span class="tr-mm-trans-meta">` +
          `<span>${formatDurationMs(durationMs)}</span>` +
          (msgCount > 0 ? `<span>· ${msgCount} msg${msgCount === 1 ? '' : 's'}</span>` : `<span style="opacity:0.5">· 0 msgs</span>`) +
        `</span>` +
      `</a>`
    )
  }

  return `<aside class="tr-minimap">` +
    `<div class="tr-minimap-head">State Transitions <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.6">(${periods.length})</span></div>` +
    rows.join('') +
  `</aside>`
}

/* ─── Tool filter chips bar ────────────────────────────────────── */
function renderToolFilterChips(counts: Record<string, number>): string {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return ''
  const chips = sorted.map(([name, n]) =>
    `<button type="button" class="tr-tool-filter-chip" data-tool-chip="${esc(name)}">${esc(name)}<span class="tr-tool-filter-count">${n}</span></button>`
  ).join('')
  return `<div class="tr-tool-filter"><span style="font-size:10px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;padding-top:4px">Tools:</span>${chips}</div>`
}

/* ─── Session Analysis summary (tokens/cost/cache/tools/models) ── */
function renderAnalysis(resp: TranscriptResponse): string {
  const path = resp.transcriptPath
  const fileName = path ? path.split('/').pop() ?? path : ''
  const sizeStr = resp.fileSize !== undefined ? formatBytes(resp.fileSize) : ''
  const modifiedStr = resp.fileModified ? formatDate(resp.fileModified) : ''
  const t = resp.totals
  const totalTokens = t.inputTokens + t.outputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens
  const totalIn = t.inputTokens + t.cacheReadInputTokens
  const hitPct = totalIn > 0 ? Math.round((t.cacheReadInputTokens / totalIn) * 100) : 0
  const models = resp.modelsUsed

  // cost from totals (approximate — assumes dominant model pricing)
  let cost = 0
  if (models.length > 0) {
    cost = costForUsage({
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheReadInputTokens: t.cacheReadInputTokens,
      cacheCreationInputTokens: t.cacheCreationInputTokens,
    }, models[0])
  }

  const aggrItems = Object.entries(resp.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => `<span class="tr-tool-aggr-item">${esc(name)} ×${n}</span>`)
    .join('')

  const modelChips = models.map(m => `<span class="tr-chip tr-chip-model">${esc(shortModel(m))}</span>`).join(' ')

  return `<div class="tr-section">` +
    `<div class="tr-section-bar">` +
      `<span class="tr-caret">▼</span>` +
      `<span class="tr-title">Session Analysis</span>` +
    `</div>` +
    `<div class="tr-section-body">` +
      (fileName ? `<div style="margin-bottom:8px;font-size:11px;color:#7f8c8d"><span style="text-transform:uppercase;letter-spacing:0.4px;font-weight:600">File:</span> <span style="font-family:monospace;color:#2c3e50">${esc(fileName)}</span></div>` : '') +
      `<div class="tr-analysis">` +
        `<span class="tr-a-item"><span class="tr-a-key">Messages</span><span class="tr-a-val">${resp.total}</span></span>` +
        (t.assistantMessages > 0 ? `<span class="tr-a-item"><span class="tr-a-key">Assistant</span><span class="tr-a-val">${t.assistantMessages}</span></span>` : '') +
        (sizeStr ? `<span class="tr-a-item"><span class="tr-a-key">Size</span><span class="tr-a-val">${sizeStr}</span></span>` : '') +
        (modifiedStr ? `<span class="tr-a-item"><span class="tr-a-key">Modified</span><span class="tr-a-val">${esc(modifiedStr)}</span></span>` : '') +
        (totalTokens > 0 ? `<span class="tr-a-item"><span class="tr-a-key">Tokens</span><span class="tr-a-val">↓${formatTokens(t.inputTokens)} ↑${formatTokens(t.outputTokens)}</span></span>` : '') +
        (t.cacheReadInputTokens > 0 ? `<span class="tr-a-item"><span class="tr-a-key">Cache hit</span><span class="tr-a-val">${hitPct}% (${formatTokens(t.cacheReadInputTokens)})</span></span>` : '') +
        (cost > 0 ? `<span class="tr-a-item"><span class="tr-a-key">Cost est.</span><span class="tr-a-val">${formatCost(cost)}</span></span>` : '') +
      `</div>` +
      (modelChips ? `<div style="margin-top:8px;display:flex;gap:4px;align-items:center"><span style="font-size:10px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Models:</span> ${modelChips}</div>` : '') +
      (aggrItems ? `<div class="tr-tool-aggr">${aggrItems}</div>` : '') +
    `</div>` +
  `</div>`
}

/* ─── Keyboard help overlay ────────────────────────────────────── */
function renderKeyboardHelp(): string {
  return `<div id="tr-kbd-help" class="tr-kbd-help">` +
    `<h4>Keyboard</h4>` +
    `<dl>` +
      `<dt>j / k</dt><dd>next / previous message</dd>` +
      `<dt>/</dt><dd>focus search</dd>` +
      `<dt>g / G</dt><dd>first / last message</dd>` +
      `<dt>a</dt><dd>toggle assistant only</dd>` +
      `<dt>t</dt><dd>toggle text only</dd>` +
      `<dt>e</dt><dd>toggle errors only</dd>` +
      `<dt>?</dt><dd>toggle this help</dd>` +
    `</dl>` +
  `</div>`
}

/* ─── Public API ───────────────────────────────────────────────── */
/** @riviere-role web-tbc */
export function renderTranscript(resp: TranscriptResponse, ctx?: TranscriptContext): string {
  const entries = resp.entries
  if (entries.length === 0) {
    return html`<div class="tr-wrap"><div class="tr-empty">No transcript entries found.</div></div>`
  }

  const session = ctx?.session
  const periods: ReadonlyArray<StatePeriod> = session?.statePeriods ?? []
  const journal: ReadonlyArray<JournalEntry> = session?.journalEntries ?? []
  const insights: ReadonlyArray<InsightEntry> = session?.insights ?? []
  const sessionId = session?.sessionId

  // Insights aren't timestamped — render up to 3 at the very top.
  const topInsights = insights.slice(0, 3).map(renderInsightAnnot).join('')

  // Interleave journal entries between transcript entries by timestamp.
  const journalSorted = [...journal].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  let journalPtr = 0

  const rowParts: Array<string> = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    const tEntry = Date.parse(e.timestamp)
    while (journalPtr < journalSorted.length) {
      const j = journalSorted[journalPtr]
      if (!j) { journalPtr++; continue }
      if (Date.parse(j.at) <= tEntry) {
        rowParts.push(renderJournalAnnot(j))
        journalPtr++
      } else break
    }
    const state = stateForTimestamp(periods, e.timestamp)
    rowParts.push(renderEntry(e, i, state, sessionId))
  }
  // flush remaining journal entries
  while (journalPtr < journalSorted.length) {
    const j = journalSorted[journalPtr++]
    if (j) rowParts.push(renderJournalAnnot(j))
  }

  const rows = topInsights + rowParts.join('')
  const toolFilter = renderToolFilterChips(resp.toolCounts)
  const analysis = renderAnalysis(resp)

  const stream =
    `<div class="tr-section">` +
      `<div class="tr-section-bar">` +
        `<span class="tr-caret">▼</span>` +
        `<span class="tr-title">Message Stream</span>` +
        `<span class="tr-bar-controls">` +
          `<button type="button" class="tr-bar-btn" id="transcript-export-md">Export .md</button>` +
          `<button type="button" class="tr-bar-btn" id="transcript-export-json">Export .json</button>` +
          `<button type="button" class="tr-bar-btn" id="transcript-kbd-toggle" title="Keyboard shortcuts (?)">⌨</button>` +
          `<span id="transcript-count">${resp.total} of ${resp.total} messages</span>` +
        `</span>` +
      `</div>` +
      `<div class="tr-controls">` +
        `<input id="transcript-search" type="text" placeholder="Search conversation... (use /regex/ for regex)" />` +
        `<label><input id="transcript-agent-only" type="checkbox" /> Assistant only</label>` +
        `<label><input id="transcript-text-only" type="checkbox" /> Text only</label>` +
        `<label><input id="transcript-errors-only" type="checkbox" /> Errors only</label>` +
        `<label><input id="transcript-hide-sidechain" type="checkbox" /> Hide sidechain</label>` +
        `<label><input id="transcript-incl-tools" type="checkbox" checked /> Match in tool output</label>` +
      `</div>` +
      toolFilter +
      `<div class="tr-stream-layout">` +
        `<div class="tr-stream-col"><div id="transcript-rows" class="tr-rows">${rows}</div></div>` +
        renderMinimap(entries, periods) +
      `</div>` +
    `</div>` +
    renderKeyboardHelp()

  return `<div class="tr-wrap">${analysis}${stream}</div>`
}

/* ─── Event handlers ───────────────────────────────────────────── */
type FilterState = {
  query: string
  regex: RegExp | null
  assistantOnly: boolean
  textOnly: boolean
  errorsOnly: boolean
  hideSidechain: boolean
  matchInTools: boolean
  toolFilter: Set<string>
}

function getFilterState(): FilterState {
  const g = (id: string) => document.getElementById(id)
  const searchVal = g('transcript-search') instanceof HTMLInputElement ? (g('transcript-search') as HTMLInputElement).value : ''
  let regex: RegExp | null = null
  let query = searchVal.toLowerCase()
  const rxMatch = searchVal.match(/^\/(.+)\/([gimsuy]*)$/)
  if (rxMatch?.[1]) {
    try { regex = new RegExp(rxMatch[1], rxMatch[2] ?? 'i'); query = '' } catch { regex = null }
  }
  const chk = (id: string): boolean => {
    const el = g(id); return el instanceof HTMLInputElement ? el.checked : false
  }
  const activeChips = Array.from(document.querySelectorAll<HTMLElement>('.tr-tool-filter-chip.active'))
    .map(el => el.getAttribute('data-tool-chip') ?? '')
    .filter(Boolean)
  return {
    query,
    regex,
    assistantOnly: chk('transcript-agent-only'),
    textOnly: chk('transcript-text-only'),
    errorsOnly: chk('transcript-errors-only'),
    hideSidechain: chk('transcript-hide-sidechain'),
    matchInTools: chk('transcript-incl-tools'),
    toolFilter: new Set(activeChips),
  }
}

function textualForMatch(row: HTMLElement, includeTools: boolean): string {
  if (includeTools) return row.textContent?.toLowerCase() ?? ''
  const clone = row.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.tr-tool, .tr-result').forEach(el => el.remove())
  return clone.textContent?.toLowerCase() ?? ''
}

function applyFilters(rowsContainer: HTMLElement): void {
  const f = getFilterState()
  let visible = 0
  rowsContainer.querySelectorAll<HTMLElement>('.tr-entry').forEach((row) => {
    const isAgent = row.classList.contains('tr-assistant')
    const isSidechain = row.getAttribute('data-sidechain') === '1'
    const hasError = row.getAttribute('data-has-error') === '1'
    const tools = (row.getAttribute('data-tools') ?? '').split(/\s+/).filter(Boolean)

    if (f.assistantOnly && !isAgent) { row.style.display = 'none'; return }
    if (f.hideSidechain && isSidechain) { row.style.display = 'none'; return }
    if (f.errorsOnly && !hasError) { row.style.display = 'none'; return }
    if (f.toolFilter.size > 0 && !tools.some(t => f.toolFilter.has(t))) { row.style.display = 'none'; return }

    const text = textualForMatch(row, f.matchInTools)
    let show = true
    if (f.regex) show = f.regex.test(text)
    else if (f.query) show = text.includes(f.query)

    row.style.display = show ? '' : 'none'
    if (show) {
      if (f.textOnly) {
        row.querySelectorAll<HTMLElement>('.tr-tool, .tr-result').forEach((el) => { el.style.display = 'none' })
      } else {
        row.querySelectorAll<HTMLElement>('.tr-tool, .tr-result').forEach((el) => { el.style.display = '' })
      }
      visible++
    }
  })
  const countEl = document.getElementById('transcript-count')
  const total = rowsContainer.querySelectorAll('.tr-entry').length
  if (countEl) countEl.textContent = `${visible} of ${total} messages`

  // sync minimap visibility
  document.querySelectorAll<HTMLElement>('.tr-mm-item').forEach((item) => {
    const idx = item.getAttribute('data-mm-idx')
    const row = document.getElementById(`msg-${idx}`)
    item.style.display = row && row.style.display !== 'none' ? '' : 'none'
  })
}

function flashMessage(id: string): void {
  const row = document.getElementById(id)
  if (!row) return
  row.classList.add('tr-flash')
  setTimeout(() => row.classList.remove('tr-flash'), 1100)
}

function exportMarkdown(entries: ReadonlyArray<HTMLElement>): string {
  const parts: Array<string> = []
  for (const row of entries) {
    const role = row.getAttribute('data-role') ?? 'other'
    const tokens = row.getAttribute('data-tokens') ?? ''
    const head = row.querySelector('.tr-entry-head')
    const time = head?.querySelector('.tr-time')?.textContent?.trim() ?? ''
    const body = row.querySelector('.tr-entry-body')?.textContent?.trim() ?? ''
    parts.push(`## ${role.toUpperCase()} — ${time}${tokens !== '0' ? ` (${tokens} tokens)` : ''}\n\n${body}\n`)
  }
  return parts.join('\n---\n\n')
}

function downloadFile(name: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function navigateMessage(delta: number): void {
  const all = Array.from(document.querySelectorAll<HTMLElement>('.tr-entry')).filter(r => r.style.display !== 'none')
  if (all.length === 0) return
  const viewportCenter = window.innerHeight / 2
  let currentIdx = 0
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.top <= viewportCenter) currentIdx = i
    else break
  }
  const target = all[Math.max(0, Math.min(all.length - 1, currentIdx + delta))]
  if (target) {
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start' 
    })
    target.classList.add('tr-flash')
    setTimeout(() => target.classList.remove('tr-flash'), 1100)
  }
}

function highlightPair(toolUseId: string): void {
  if (!toolUseId) return
  document.querySelectorAll<HTMLElement>('.tr-pair-hl').forEach(el => el.classList.remove('tr-pair-hl'))
  const use = document.querySelector<HTMLElement>(`.tr-tool[data-tool-id="${CSS.escape(toolUseId)}"]`)
  const result = document.querySelector<HTMLElement>(`.tr-result[data-tool-use-id="${CSS.escape(toolUseId)}"]`)
  if (use) use.classList.add('tr-pair-hl')
  if (result) result.classList.add('tr-pair-hl')
  const target = result ?? use
  if (target) target.scrollIntoView({
    behavior: 'smooth',
    block: 'center' 
  })
  setTimeout(() => {
    if (use) use.classList.remove('tr-pair-hl')
    if (result) result.classList.remove('tr-pair-hl')
  }, 1800)
}

/** @riviere-role web-tbc */
export function attachTranscriptListeners(): void {
  const rowsContainer = document.getElementById('transcript-rows')
  if (!rowsContainer) return

  // Expand / collapse tool & thinking bodies, pair highlighting, permalink copy
  rowsContainer.addEventListener('click', (e) => {
    const t = e.target as HTMLElement

    // Text collapse expander
    const expand = t.closest('[data-expand]')
    if (expand instanceof HTMLElement) {
      const id = expand.getAttribute('data-expand')
      if (id) {
        const box = document.getElementById(id)
        if (box) {
          box.classList.toggle('open')
          expand.textContent = box.classList.contains('open') ? 'Collapse' : (expand.textContent ?? '').replace(/^Collapse$/, 'Show all')
        }
      }
      return
    }

    // "events →" cross-tab jump
    const gotoEv = t.closest('[data-goto-events]')
    if (gotoEv instanceof HTMLElement) {
      e.preventDefault()
      const ts = gotoEv.getAttribute('data-goto-events') ?? ''
      window.dispatchEvent(new CustomEvent('tr:goto-events', { detail: { timestamp: ts } }))
      return
    }

    // Permalink
    const plink = t.closest('[data-permalink]')
    if (plink instanceof HTMLAnchorElement) {
      e.preventDefault()
      const idx = plink.getAttribute('data-permalink')
      const url = `${window.location.origin}${window.location.pathname}${window.location.hash.split('#msg-')[0]}#msg-${idx}`
      navigator.clipboard.writeText(url).catch(() => {})
      flashMessage(`msg-${idx}`)
      history.replaceState(null, '', `#msg-${idx}`)
      return
    }

    // Toggle a body
    const head = t.closest('[data-toggle]')
    if (head instanceof HTMLElement) {
      const targetId = head.getAttribute('data-toggle')
      if (targetId) {
        const body = document.getElementById(targetId)
        if (body) {
          const isOpen = body.classList.contains('open')
          body.classList.toggle('open', !isOpen)
          const arrow = head.querySelector('.tr-tool-arrow, .tr-result-arrow, .tr-thinking-arrow')
          if (arrow) arrow.textContent = isOpen ? '▶' : '▼'
        }
      }

      // Also highlight pair on click
      const pairId = head.getAttribute('data-pair-src')
      if (pairId) highlightPair(pairId)
      return
    }
  })

  const doApply = (): void => applyFilters(rowsContainer)
  document.getElementById('transcript-search')?.addEventListener('input', doApply)
  document.getElementById('transcript-agent-only')?.addEventListener('change', doApply)
  document.getElementById('transcript-text-only')?.addEventListener('change', doApply)
  document.getElementById('transcript-errors-only')?.addEventListener('change', doApply)
  document.getElementById('transcript-hide-sidechain')?.addEventListener('change', doApply)
  document.getElementById('transcript-incl-tools')?.addEventListener('change', doApply)

  // Tool filter chips
  document.querySelectorAll<HTMLElement>('.tr-tool-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active')
      doApply()
    })
  })

  // Minimap scroll-to (handles both legacy .tr-mm-item and new .tr-mm-transition rows)
  document.querySelectorAll<HTMLAnchorElement>('.tr-mm-item, .tr-mm-transition').forEach((item) => {
    item.addEventListener('click', (e) => {
      const idx = item.getAttribute('data-mm-idx')
      if (!idx) { e.preventDefault(); return }
      e.preventDefault()
      const row = document.getElementById(`msg-${idx}`)
      if (row) { row.scrollIntoView({
        behavior: 'smooth',
        block: 'start' 
      }); flashMessage(`msg-${idx}`) }
      document.querySelectorAll('.tr-mm-item.active, .tr-mm-transition.active').forEach(el => el.classList.remove('active'))
      item.classList.add('active')
    })
  })

  // Export buttons
  document.getElementById('transcript-export-md')?.addEventListener('click', () => {
    const rows = Array.from(rowsContainer.querySelectorAll<HTMLElement>('.tr-entry')).filter(r => r.style.display !== 'none')
    downloadFile('transcript.md', exportMarkdown(rows), 'text/markdown')
  })
  document.getElementById('transcript-export-json')?.addEventListener('click', () => {
    const rows = Array.from(rowsContainer.querySelectorAll<HTMLElement>('.tr-entry')).filter(r => r.style.display !== 'none')
    const items = rows.map(r => ({
      idx: Number(r.getAttribute('data-idx')),
      role: r.getAttribute('data-role'),
      tools: (r.getAttribute('data-tools') ?? '').split(/\s+/).filter(Boolean),
      hasError: r.getAttribute('data-has-error') === '1',
      tokens: Number(r.getAttribute('data-tokens')),
      text: r.querySelector('.tr-entry-body')?.textContent?.trim() ?? '',
    }))
    downloadFile('transcript.json', JSON.stringify(items, null, 2), 'application/json')
  })

  // Keyboard help toggle
  const kbdHelp = document.getElementById('tr-kbd-help')
  document.getElementById('transcript-kbd-toggle')?.addEventListener('click', () => {
    kbdHelp?.classList.toggle('open')
  })

  // Keyboard navigation
  const onKey = (e: KeyboardEvent): void => {
    const active = document.activeElement
    const inField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    if (inField && e.key !== 'Escape') return
    if (e.key === 'j') { e.preventDefault(); navigateMessage(1) }
    else if (e.key === 'k') { e.preventDefault(); navigateMessage(-1) }
    else if (e.key === '/') {
      e.preventDefault()
      const s = document.getElementById('transcript-search')
      if (s instanceof HTMLInputElement) s.focus()
    }
    else if (e.key === 'a') { const el = document.getElementById('transcript-agent-only'); if (el instanceof HTMLInputElement) { el.checked = !el.checked; doApply() } }
    else if (e.key === 't') { const el = document.getElementById('transcript-text-only'); if (el instanceof HTMLInputElement) { el.checked = !el.checked; doApply() } }
    else if (e.key === 'e') { const el = document.getElementById('transcript-errors-only'); if (el instanceof HTMLInputElement) { el.checked = !el.checked; doApply() } }
    else if (e.key === 'g' && !e.shiftKey) {
      const first = document.querySelector<HTMLElement>('.tr-entry')
      if (first) first.scrollIntoView({
        behavior: 'smooth',
        block: 'start' 
      })
    }
    else if (e.key === 'G' || (e.key === 'g' && e.shiftKey)) {
      const all = document.querySelectorAll<HTMLElement>('.tr-entry')
      const last = all[all.length - 1]
      if (last) last.scrollIntoView({
        behavior: 'smooth',
        block: 'start' 
      })
    }
    else if (e.key === '?') { kbdHelp?.classList.toggle('open') }
    else if (e.key === 'Escape') { kbdHelp?.classList.remove('open') }
  }
  // Only attach once per session to avoid stacking
  const w = window as unknown as Record<string, unknown>
  if (w['__trKbdAttached'] !== true) {
    document.addEventListener('keydown', onKey)
    w['__trKbdAttached'] = true
  }

  // Deep-link: if URL has #msg-N, scroll into view
  const hash = window.location.hash
  const m = hash.match(/#msg-(\d+)/)
  if (m) {
    const id = `msg-${m[1]}`
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) { el.scrollIntoView({
        behavior: 'smooth',
        block: 'start' 
      }); flashMessage(id) }
    }, 50)
  }
}
