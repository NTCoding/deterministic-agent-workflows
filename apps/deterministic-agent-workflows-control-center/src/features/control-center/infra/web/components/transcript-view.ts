import type {
  SessionDetailDto,
  TranscriptContentBlock,
  TranscriptEntry,
  TranscriptResponse,
  TranscriptUsage,
} from '../api-client'
import {
  esc,
  html,
} from '../render'

/** @riviere-role web-tbc */
export type TranscriptContext = {readonly session?: SessionDetailDto | undefined}

function formatTimestamp(iso: string): string {
  return iso.length >= 19 ? iso.slice(0, 19).replace('T', ' ') : iso
}

function usageSummary(usage: TranscriptUsage | undefined): string {
  if (usage === undefined) {
    return ''
  }
  const total = usage.inputTokens + usage.outputTokens
  return ` · ${total.toLocaleString()} tokens`
}

function renderTextBlock(text: string): string {
  return `<div class="tr-text">${esc(text)}</div>`
}

function renderToolUseBlock(block: Extract<TranscriptContentBlock, { readonly kind: 'tool_use' }>): string {
  const inputJson = esc(JSON.stringify(block.input, null, 2))
  return `<div class="tr-tool">` +
    `<div class="tr-tool-head"><span class="tr-tool-name">⚙ ${esc(block.name)}</span></div>` +
    `<pre class="tr-tool-body open">${inputJson}</pre>` +
    `</div>`
}

function renderToolResultBlock(block: Extract<TranscriptContentBlock, { readonly kind: 'tool_result' }>): string {
  const cls = block.isError ? 'tr-result tr-result-error' : 'tr-result'
  return `<div class="${cls}">` +
    `<div class="tr-result-head"><span class="tr-result-name">↩ ${esc(block.toolName)}</span></div>` +
    `<pre class="tr-result-body open">${esc(block.text)}</pre>` +
    `</div>`
}

function renderContentBlock(block: TranscriptContentBlock): string {
  if (block.kind === 'text') {
    return renderTextBlock(block.text)
  }
  if (block.kind === 'thinking') {
    return `<div class="tr-thinking"><div class="tr-thinking-head">Thinking</div><div class="tr-thinking-body open">${esc(block.text)}</div></div>`
  }
  if (block.kind === 'tool_use') {
    return renderToolUseBlock(block)
  }
  return renderToolResultBlock(block)
}

function entryRoleLabel(entry: TranscriptEntry): string {
  if (entry.type === 'assistant') {
    return 'ASSISTANT'
  }
  if (entry.type === 'user') {
    return 'USER'
  }
  if (entry.type === 'system') {
    return 'SYSTEM'
  }
  return 'OTHER'
}

function entryRoleClass(entry: TranscriptEntry): string {
  if (entry.type === 'assistant') {
    return 'tr-assistant'
  }
  if (entry.type === 'user') {
    return 'tr-user'
  }
  if (entry.type === 'system') {
    return 'tr-system'
  }
  return 'tr-other'
}

function renderEntry(entry: TranscriptEntry): string {
  const header = html`<div class="tr-entry-head"><span class="tr-role"><span class="tr-role-label">${entryRoleLabel(entry)}</span></span><span class="tr-time">${esc(formatTimestamp(entry.timestamp))}${esc(usageSummary(entry.usage))}</span></div>`
  const body = entry.content.map(renderContentBlock).join('')
  return `<article class="tr-entry ${entryRoleClass(entry)}">${header}<div class="tr-entry-body">${body}</div></article>`
}

function modelSummary(modelsUsed: ReadonlyArray<string>): string {
  if (modelsUsed.length === 0) {
    return 'unknown'
  }
  return modelsUsed.join(', ')
}

function renderHeader(resp: TranscriptResponse, ctx: TranscriptContext | undefined): string {
  const sessionLabel = ctx?.session?.sessionId === undefined ? '' : ` · Session ${esc(ctx.session.sessionId)}`
  const tokens = resp.totals.inputTokens + resp.totals.outputTokens
  return `<div class="tr-section">` +
    `<div class="tr-section-bar"><span class="tr-title">Session Analysis</span></div>` +
    `<div class="tr-section-body"><div class="tr-analysis">` +
    `<span class="tr-a-item"><span class="tr-a-key">entries</span><span class="tr-a-val">${resp.total}${sessionLabel}</span></span>` +
    `<span class="tr-a-item"><span class="tr-a-key">tokens</span><span class="tr-a-val">${tokens.toLocaleString()}</span></span>` +
    `<span class="tr-a-item"><span class="tr-a-key">models</span><span class="tr-a-val">${esc(modelSummary(resp.modelsUsed))}</span></span>` +
    `<span class="tr-a-item"><span class="tr-a-key">path</span><span class="tr-a-path">${esc(resp.transcriptPath)}</span></span>` +
    `</div></div>` +
    `</div>`
}

function renderEmptyState(): string {
  return '<div class="tr-empty">No transcript entries available.</div>'
}

/** @riviere-role web-tbc */
export function renderTranscript(resp: TranscriptResponse, ctx?: TranscriptContext): string {
  const header = renderHeader(resp, ctx)
  const list = resp.entries.length === 0 ? renderEmptyState() : resp.entries.map(renderEntry).join('')
  return `<div class="tr-wrap">` +
    header +
    `<div class="tr-section">` +
    `<div class="tr-section-bar"><span class="tr-title">Message Stream</span></div>` +
    `<div class="tr-stream-layout"><div class="tr-stream-col"><div class="tr-rows">${list}</div></div></div>` +
    `</div>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function attachTranscriptListeners(): void {
  const links = document.querySelectorAll<HTMLElement>('[data-tr-goto="events"]')
  for (const link of links) {
    link.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('tr:goto-events'))
    })
  }
}
