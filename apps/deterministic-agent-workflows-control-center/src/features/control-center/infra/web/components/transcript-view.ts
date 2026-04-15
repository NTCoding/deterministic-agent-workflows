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
  return `<div class="tr-block tr-text">${esc(text)}</div>`
}

function renderToolUseBlock(block: Extract<TranscriptContentBlock, { readonly kind: 'tool_use' }>): string {
  const inputJson = esc(JSON.stringify(block.input, null, 2))
  return `<details class="tr-tool">` +
    `<summary>⚙ ${esc(block.name)}</summary>` +
    `<pre>${inputJson}</pre>` +
    `</details>`
}

function renderToolResultBlock(block: Extract<TranscriptContentBlock, { readonly kind: 'tool_result' }>): string {
  const cls = block.isError ? 'tr-block tr-result tr-error' : 'tr-block tr-result'
  return `<div class="${cls}">` +
    `<div class="tr-meta">↩ ${esc(block.toolName)}</div>` +
    `<pre>${esc(block.text)}</pre>` +
    `</div>`
}

function renderContentBlock(block: TranscriptContentBlock): string {
  if (block.kind === 'text') {
    return renderTextBlock(block.text)
  }
  if (block.kind === 'thinking') {
    return `<details class="tr-thinking"><summary>Thinking</summary><pre>${esc(block.text)}</pre></details>`
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

function renderEntry(entry: TranscriptEntry): string {
  const header = html`<div class="tr-entry-head"><strong>${entryRoleLabel(entry)}</strong> ${esc(formatTimestamp(entry.timestamp))}${esc(usageSummary(entry.usage))}</div>`
  const body = entry.content.map(renderContentBlock).join('')
  return `<article class="tr-entry">${header}<div class="tr-entry-body">${body}</div></article>`
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
  return `<div class="tr-header">` +
    `<div><strong>${resp.total}</strong> entries${sessionLabel}</div>` +
    `<div><strong>${tokens.toLocaleString()}</strong> tokens · models: ${esc(modelSummary(resp.modelsUsed))}</div>` +
    `<div class="tr-path">${esc(resp.transcriptPath)}</div>` +
    `</div>`
}

function renderEmptyState(): string {
  return '<div class="tr-empty">No transcript entries available.</div>'
}

/** @riviere-role web-tbc */
export function renderTranscript(resp: TranscriptResponse, ctx?: TranscriptContext): string {
  const header = renderHeader(resp, ctx)
  const list = resp.entries.length === 0 ? renderEmptyState() : resp.entries.map(renderEntry).join('')
  return `<div class="tr-wrap">${header}<div class="tr-list">${list}</div></div>`
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
