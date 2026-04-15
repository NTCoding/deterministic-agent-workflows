import type {
  TranscriptEntry, TranscriptContentBlock 
} from '../api-client'
import { esc } from '../render'
import type {
  JournalEntry, InsightEntry 
} from './transcript-view-format'
import {
  formatTime, formatDate, formatTokens, shortModel, stateCssClass 
} from './transcript-view-format'
import { renderContentBlock } from './transcript-view-blocks'

function hasOnlyToolResults(content: ReadonlyArray<TranscriptContentBlock>): boolean {
  return content.length > 0 && content.every(b => b.kind === 'tool_result')
}

function roleLabel(type: TranscriptEntry['type'], content: ReadonlyArray<TranscriptContentBlock>): string {
  if (type === 'assistant') return 'ASSISTANT'
  if (type === 'system') return 'SYSTEM'
  if (type === 'other') return 'OTHER'
  return hasOnlyToolResults(content) ? 'TOOL RESULT' : 'USER'
}

function roleTag(type: TranscriptEntry['type'], content: ReadonlyArray<TranscriptContentBlock>): string {
  if (type === 'assistant') return '[assistant]'
  if (type === 'system') return '[system]'
  if (type === 'other') return '[other]'
  return hasOnlyToolResults(content) ? '[tool_result]' : '[user]'
}

function roleDot(type: TranscriptEntry['type']): string {
  if (type === 'assistant') return '◆'
  if (type === 'system') return '■'
  if (type === 'other') return '○'
  return '●'
}

function renderUsageChips(usage: NonNullable<TranscriptEntry['usage']>): ReadonlyArray<string> {
  const cached = usage.cacheReadInputTokens
  const totalIn = usage.inputTokens + cached
  const hitPct = totalIn > 0 ? Math.round((cached / totalIn) * 100) : 0
  const title = `input ${usage.inputTokens} / output ${usage.outputTokens} / cache-read ${usage.cacheReadInputTokens} / cache-write ${usage.cacheCreationInputTokens}`
  const chips = [
    `<span class="tr-chip tr-chip-tokens" title="${title}">↓${formatTokens(usage.inputTokens)} ↑${formatTokens(usage.outputTokens)}</span>`,
  ]
  if (cached > 0) chips.push(`<span class="tr-chip tr-chip-cache" title="cache read ${cached} tokens">⚡ ${hitPct}% cached</span>`)
  return chips
}

function renderChips(entry: TranscriptEntry, state: string | null): string {
  const chips: Array<string> = []
  if (state !== null) chips.push(`<span class="tr-state-chip ${stateCssClass(state)}" title="state at this point">${esc(state)}</span>`)
  if (entry.model !== undefined) chips.push(`<span class="tr-chip tr-chip-model">${esc(shortModel(entry.model))}</span>`)
  if (entry.stopReason !== undefined && entry.stopReason !== 'end_turn') chips.push(`<span class="tr-chip tr-chip-stop">⏹ ${esc(entry.stopReason)}</span>`)
  if (entry.isSidechain === true) chips.push(`<span class="tr-chip tr-chip-sidechain">sidechain</span>`)
  if (entry.usage !== undefined) chips.push(...renderUsageChips(entry.usage))
  return chips.join('')
}

function renderEventsLink(sessionId: string | undefined, timestamp: string): string {
  if (sessionId === undefined) return ''
  return ` <a href="#" class="tr-permalink tr-goto-events" data-goto-events="${esc(timestamp)}" title="jump to events near this time">events →</a>`
}

function renderEntryHeader(entry: TranscriptEntry, idx: number, state: string | null, sessionId: string | undefined): string {
  const time = formatTime(entry.timestamp)
  const date = formatDate(entry.timestamp)
  const label = roleLabel(entry.type, entry.content)
  const tag = roleTag(entry.type, entry.content)
  const dot = roleDot(entry.type)
  const chips = renderChips(entry, state)
  return `<div class="tr-entry-head">` +
    `<span class="tr-role">` +
      `<span class="tr-role-dot">${dot}</span>` +
      `<span class="tr-role-label">${label}</span>` +
      `<span class="tr-role-tag">${tag}</span>` +
    `</span>` +
    chips +
    `<span class="tr-time">${esc(date)} ${esc(time)}` +
      ` <a href="#msg-${idx}" class="tr-permalink" data-permalink="${idx}" title="copy link to message">#${idx}</a>` +
      renderEventsLink(sessionId, entry.timestamp) +
    `</span>` +
  `</div>`
}

function entryCssClass(type: TranscriptEntry['type']): string {
  if (type === 'assistant') return 'tr-assistant'
  if (type === 'user') return 'tr-user'
  if (type === 'system') return 'tr-system'
  return 'tr-other'
}

function collectToolNames(content: ReadonlyArray<TranscriptContentBlock>): string {
  return content.flatMap(b => b.kind === 'tool_use' ? [b.name] : []).join(' ')
}

function anyErrorResult(content: ReadonlyArray<TranscriptContentBlock>): boolean {
  return content.some(b => b.kind === 'tool_result' && b.isError)
}

/** @riviere-role web-tbc */
export function renderEntry(
  entry: TranscriptEntry,
  idx: number,
  state: string | null,
  sessionId: string | undefined,
): string {
  const cls = entryCssClass(entry.type)
  const sidechainCls = entry.isSidechain === true ? ' tr-sidechain' : ''
  const contentHtml = entry.content.map(renderContentBlock).join('')
  const toolNamesInEntry = collectToolNames(entry.content)
  const hasError = anyErrorResult(entry.content) ? '1' : '0'
  const tokens = entry.usage === undefined ? 0 : entry.usage.inputTokens + entry.usage.outputTokens
  const emptyBody = '<div class="tr-text" style="color:#95a5a6;font-style:italic">(no content)</div>'
  const body = contentHtml.length > 0 ? contentHtml : emptyBody
  const stateAttr = state === null ? '' : esc(state)
  return `<div id="msg-${idx}" class="tr-entry ${cls}${sidechainCls}" data-idx="${idx}" data-role="${entry.type}" data-tools="${esc(toolNamesInEntry)}" data-has-error="${hasError}" data-tokens="${tokens}" data-sidechain="${entry.isSidechain === true ? '1' : '0'}" data-state="${stateAttr}" data-ts="${esc(entry.timestamp)}">` +
    renderEntryHeader(entry, idx, state, sessionId) +
    `<div class="tr-entry-body">${body}</div>` +
  `</div>`
}

/** @riviere-role web-tbc */
export function renderJournalAnnot(j: JournalEntry): string {
  const stateSuffix = j.state.length > 0 ? ` · ${esc(j.state)}` : ''
  return `<div class="tr-journal-annot" data-ts="${esc(j.at)}">` +
    `<span class="tr-ja-agent">📓 ${esc(j.agentName)}</span>` +
    `<span style="font-family:monospace;font-size:10px;color:#7f8c8d">${esc(formatTime(j.at))}${stateSuffix}</span>` +
    `<div style="margin-top:4px;white-space:pre-wrap">${esc(j.content)}</div>` +
  `</div>`
}

function insightIcon(severity: string): string {
  if (severity === 'warning') return '⚠'
  if (severity === 'success') return '✓'
  return 'ℹ'
}

/** @riviere-role web-tbc */
export function renderInsightAnnot(ins: InsightEntry): string {
  const icon = insightIcon(ins.severity)
  const evidence = ins.evidence.length > 0 ? `<div style="margin-top:4px">${esc(ins.evidence)}</div>` : ''
  return `<div class="tr-insight-annot"><strong>${icon} ${esc(ins.title)}</strong>${evidence}</div>`
}
