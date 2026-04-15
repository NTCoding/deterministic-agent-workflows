import type {
  TranscriptEntry, TranscriptResponse 
} from '../api-client'
import { esc } from '../render'
import type { StatePeriod } from './transcript-view-format'
import {
  formatBytes,
  formatDate,
  formatDurationMs,
  formatTime,
  formatTokens,
  shortModel,
  stateCssClass,
} from './transcript-view-format'

function parseTsOrNull(iso: string): number | null {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

function firstEntryIdxInRange(entries: ReadonlyArray<TranscriptEntry>, startMs: number, endMs: number): number {
  return entries.findIndex(e => {
    const t = parseTsOrNull(e.timestamp)
    return t !== null && t >= startMs && t <= endMs
  })
}

function countEntriesInRange(entries: ReadonlyArray<TranscriptEntry>, startMs: number, endMs: number): number {
  return entries.filter(e => {
    const t = parseTsOrNull(e.timestamp)
    return t !== null && t >= startMs && t <= endMs
  }).length
}

function msgSuffix(count: number): string {
  if (count === 0) return `<span style="opacity:0.5">· 0 msgs</span>`
  const word = count === 1 ? 'msg' : 'msgs'
  return `<span>· ${count} ${word}</span>`
}

function renderMinimapRow(p: StatePeriod, entries: ReadonlyArray<TranscriptEntry>): string {
  const startMs = Date.parse(p.startedAt)
  const endMs = p.endedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(p.endedAt)
  const firstIdx = firstEntryIdxInRange(entries, startMs, endMs)
  const msgCount = countEntriesInRange(entries, startMs, endMs)
  const nowOrEnd = p.endedAt === undefined ? Date.now() : Date.parse(p.endedAt)
  const durationMs = nowOrEnd - startMs
  const clickable = firstIdx >= 0
  const targetAttr = clickable ? ` href="#msg-${firstIdx}" data-mm-idx="${firstIdx}"` : ' data-mm-idx=""'
  const emptyCls = clickable ? '' : ' tr-mm-empty'
  return `<a class="tr-mm-transition${emptyCls}"${targetAttr}>` +
    `<span class="tr-mm-trans-main">` +
      `<span class="tr-state-chip ${stateCssClass(p.state)}">${esc(p.state)}</span>` +
      `<span class="tr-mm-trans-time">${esc(formatTime(p.startedAt))}</span>` +
    `</span>` +
    `<span class="tr-mm-trans-meta">` +
      `<span>${formatDurationMs(durationMs)}</span>` +
      msgSuffix(msgCount) +
    `</span>` +
  `</a>`
}

/** @riviere-role web-tbc */
export function renderMinimap(
  entries: ReadonlyArray<TranscriptEntry>,
  periods: ReadonlyArray<StatePeriod>,
): string {
  if (periods.length === 0) {
    return `<aside class="tr-minimap">` +
      `<div class="tr-minimap-head">Outline</div>` +
      `<div style="padding:12px;color:#95a5a6;font-size:11px;font-style:italic">No state transitions recorded for this session.</div>` +
    `</aside>`
  }
  const rows = periods.map(p => renderMinimapRow(p, entries)).join('')
  const countSuffix = `<span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.6">(${periods.length})</span>`
  return `<aside class="tr-minimap">` +
    `<div class="tr-minimap-head">State Transitions ${countSuffix}</div>` +
    rows +
  `</aside>`
}

/** @riviere-role web-tbc */
export function renderToolFilterChips(counts: Record<string, number>): string {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return ''
  const label = `<span style="font-size:10px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;padding-top:4px">Tools:</span>`
  const chips = sorted.map(([name, n]) =>
    `<button type="button" class="tr-tool-filter-chip" data-tool-chip="${esc(name)}">${esc(name)}<span class="tr-tool-filter-count">${n}</span></button>`
  ).join('')
  return `<div class="tr-tool-filter">${label}${chips}</div>`
}

function renderAnalysisFileHeader(fileName: string): string {
  if (fileName.length === 0) return ''
  const key = `<span style="text-transform:uppercase;letter-spacing:0.4px;font-weight:600">File:</span>`
  const name = `<span style="font-family:monospace;color:#2c3e50">${esc(fileName)}</span>`
  return `<div style="margin-bottom:8px;font-size:11px;color:#7f8c8d">${key} ${name}</div>`
}

function analysisItem(key: string, value: string): string {
  return `<span class="tr-a-item"><span class="tr-a-key">${key}</span><span class="tr-a-val">${value}</span></span>`
}

function renderAnalysisItems(resp: TranscriptResponse): string {
  const t = resp.totals
  const totalTokens = t.inputTokens + t.outputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens
  const totalIn = t.inputTokens + t.cacheReadInputTokens
  const hitPct = totalIn > 0 ? Math.round((t.cacheReadInputTokens / totalIn) * 100) : 0
  const sizeStr = resp.fileSize === undefined ? '' : formatBytes(resp.fileSize)
  const modifiedStr = resp.fileModified === undefined ? '' : formatDate(resp.fileModified)
  const items: Array<string> = [analysisItem('Messages', String(resp.total))]
  if (t.assistantMessages > 0) items.push(analysisItem('Assistant', String(t.assistantMessages)))
  if (sizeStr.length > 0) items.push(analysisItem('Size', sizeStr))
  if (modifiedStr.length > 0) items.push(analysisItem('Modified', esc(modifiedStr)))
  if (totalTokens > 0) items.push(analysisItem('Tokens', `↓${formatTokens(t.inputTokens)} ↑${formatTokens(t.outputTokens)}`))
  if (t.cacheReadInputTokens > 0) items.push(analysisItem('Cache hit', `${hitPct}% (${formatTokens(t.cacheReadInputTokens)})`))
  return items.join('')
}

function renderModelsRow(models: ReadonlyArray<string>): string {
  if (models.length === 0) return ''
  const chips = models.map(m => `<span class="tr-chip tr-chip-model">${esc(shortModel(m))}</span>`).join(' ')
  const label = `<span style="font-size:10px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Models:</span>`
  return `<div style="margin-top:8px;display:flex;gap:4px;align-items:center">${label} ${chips}</div>`
}

function renderAggregatedTools(counts: Record<string, number>): string {
  const items = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => `<span class="tr-tool-aggr-item">${esc(name)} ×${n}</span>`)
    .join('')
  return items.length > 0 ? `<div class="tr-tool-aggr">${items}</div>` : ''
}

/** @riviere-role web-tbc */
export function renderAnalysis(resp: TranscriptResponse): string {
  const fileName = resp.transcriptPath.split('/').pop() ?? resp.transcriptPath
  const body =
    renderAnalysisFileHeader(fileName) +
    `<div class="tr-analysis">${renderAnalysisItems(resp)}</div>` +
    renderModelsRow(resp.modelsUsed) +
    renderAggregatedTools(resp.toolCounts)
  return `<div class="tr-section">` +
    `<div class="tr-section-bar">` +
      `<span class="tr-caret">▼</span>` +
      `<span class="tr-title">Session Analysis</span>` +
    `</div>` +
    `<div class="tr-section-body">${body}</div>` +
  `</div>`
}

/** @riviere-role web-tbc */
export function renderKeyboardHelp(): string {
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
