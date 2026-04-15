import type { TranscriptContentBlock } from '../api-client'
import { esc } from '../render'
import { nextId } from './transcript-view-format'

type DiffInputs = {
  readonly oldStr: string | null
  readonly newStr: string | null
  readonly content: string | null
  readonly filePath: string | null
}

function extractDiffInputs(input: Record<string, unknown>): DiffInputs {
  return {
    oldStr: typeof input['old_string'] === 'string' ? input['old_string'] : null,
    newStr: typeof input['new_string'] === 'string' ? input['new_string'] : null,
    content: typeof input['content'] === 'string' ? input['content'] : null,
    filePath: typeof input['file_path'] === 'string' ? input['file_path'] : null,
  }
}

function renderDiffLines(prefix: '+' | '-', cls: 'add' | 'del', body: string): string {
  return body.split('\n').map(l => `<div class="tr-diff-line ${cls}">${prefix} ${esc(l)}</div>`).join('')
}

function renderDiffPair(oldStr: string, newStr: string, filePath: string | null): string {
  const pathHdr = filePath === null ? '' : `<div class="tr-diff-label">${esc(filePath)}</div>`
  return `<div class="tr-diff">${pathHdr}${renderDiffLines('-', 'del', oldStr)}${renderDiffLines('+', 'add', newStr)}</div>`
}

function renderDiffWrite(content: string, filePath: string): string {
  const allLines = content.split('\n')
  const preview = allLines.slice(0, 80)
  const truncated = allLines.length > 80
    ? '<div class="tr-diff-line" style="color:#999">… (truncated)</div>'
    : ''
  return `<div class="tr-diff"><div class="tr-diff-label">${esc(filePath)}</div>${renderDiffLines('+', 'add', preview.join('\n'))}${truncated}</div>`
}

function renderDiff(input: Record<string, unknown>): string {
  const d = extractDiffInputs(input)
  if (d.oldStr !== null && d.newStr !== null) return renderDiffPair(d.oldStr, d.newStr, d.filePath)
  if (d.content !== null && d.filePath !== null) return renderDiffWrite(d.content, d.filePath)
  return ''
}

function buildPreview(input: Record<string, unknown>): string {
  const key = Object.keys(input)[0]
  if (key === undefined) return ''
  const rawValue = Object.values(input)[0]
  const stringValue = rawValue === undefined || rawValue === null ? '' : String(rawValue)
  const val = stringValue.slice(0, 80).replaceAll('\n', ' ')
  return `${key}: ${val}`
}

const DIFFABLE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])

function renderToolUseBlock(id: string, name: string, input: Record<string, unknown>): string {
  const preview = buildPreview(input)
  const fullJson = esc(JSON.stringify(input, null, 2))
  const bodyId = id.length > 0 ? `tool-${id}` : nextId('tool')
  const diffHtml = DIFFABLE_TOOLS.has(name) ? renderDiff(input) : ''
  const previewMarkup = preview.length > 0 ? `<span class="tr-tool-preview">${esc(preview)}</span>` : '<span class="tr-tool-preview"></span>'
  const body = `<div id="${bodyId}" class="tr-tool-body"><pre>${fullJson}</pre>${diffHtml}</div>`
  return `<div class="tr-tool" data-tool-id="${esc(id)}" data-tool-name="${esc(name)}">` +
    `<div class="tr-tool-head" data-toggle="${bodyId}" data-pair-src="${esc(id)}">` +
      `<span class="tr-tool-name">⚙ ${esc(name)}</span>` +
      previewMarkup +
      `<span class="tr-tool-arrow">▶</span>` +
    `</div>` +
    body +
  `</div>`
}

function renderToolResultBlock(toolUseId: string, toolName: string, text: string, isError: boolean): string {
  const preview = text.slice(0, 120).replaceAll(/\s+/g, ' ')
  const bodyId = toolUseId.length > 0 ? `result-${toolUseId}` : nextId('result')
  const escaped = esc(text)
  const cls = isError ? 'tr-result tr-result-error' : 'tr-result'
  const errBadge = isError ? ` <span class="tr-chip tr-chip-error">ERROR</span>` : ''
  const ellipsis = text.length > 120 ? '…' : ''
  return `<div class="${cls}" data-tool-use-id="${esc(toolUseId)}">` +
    `<div class="tr-result-head" data-toggle="${bodyId}" data-pair-src="${esc(toolUseId)}">` +
      `<span class="tr-result-name">↩ ${esc(toolName)}${errBadge}</span>` +
      `<span class="tr-result-preview">${esc(preview)}${ellipsis}</span>` +
      `<span class="tr-result-arrow">▶</span>` +
    `</div>` +
    `<pre id="${bodyId}" class="tr-result-body">${escaped}</pre>` +
  `</div>`
}

function renderThinkingBlock(text: string): string {
  const id = nextId('think')
  return `<div class="tr-thinking">` +
    `<div class="tr-thinking-head" data-toggle="${id}">` +
      `<span>🧠 Thinking</span>` +
      `<span class="tr-thinking-arrow">▶</span>` +
    `</div>` +
    `<div id="${id}" class="tr-thinking-body">${esc(text)}</div>` +
  `</div>`
}

function renderTextBlock(text: string): string {
  const lineCount = [...text.matchAll(/\n/g)].length + 1
  if (lineCount <= 30) return `<div class="tr-text">${esc(text)}</div>`
  const id = nextId('txt')
  return `<div class="tr-text-collapse" id="${id}">` +
    `<div class="tr-text">${esc(text)}</div>` +
    `</div>` +
    `<button type="button" class="tr-text-expand" data-expand="${id}">Show all ${lineCount} lines</button>`
}

/** @riviere-role web-tbc */
export function renderContentBlock(block: TranscriptContentBlock): string {
  if (block.kind === 'text') return renderTextBlock(block.text)
  if (block.kind === 'thinking') return renderThinkingBlock(block.text)
  if (block.kind === 'tool_use') return renderToolUseBlock(block.id, block.name, block.input)
  return renderToolResultBlock(block.toolUseId, block.toolName, block.text, block.isError)
}
