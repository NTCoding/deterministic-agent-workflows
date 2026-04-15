import type { TranscriptEntry, TranscriptContentBlock } from '../api-client'
import { html, esc } from '../render'

function formatTime(iso: string): string {
  if (!iso) return ''
  return iso.slice(11, 19)
}

function renderToolUseBlock(name: string, input: Record<string, unknown>): string {
  const key = Object.keys(input)[0] ?? ''
  const val = key ? String(Object.values(input)[0] ?? '').slice(0, 80) : ''
  const preview = key ? `${key}: ${val}` : ''
  const fullJson = esc(JSON.stringify(input, null, 2))
  const id = `tool-${Math.random().toString(36).slice(2)}`
  return `<div class="tr-tool" style="margin:4px 0">` +
    `<div class="tr-tool-head" data-toggle="${id}" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:#f0f4f8;border:1px solid #dde3eb;border-radius:4px;padding:3px 8px;font-size:11px;font-family:monospace">` +
    `<span style="color:#3498db">⚙ ${esc(name)}</span>` +
    (preview ? `<span style="color:#888">${esc(preview)}</span>` : '') +
    `<span style="color:#aaa;font-size:10px">▶</span>` +
    `</div>` +
    `<pre id="${id}" style="display:none;margin:4px 0 0 0;background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;white-space:pre-wrap">${fullJson}</pre>` +
    `</div>`
}

function renderToolResultBlock(toolName: string, text: string): string {
  const preview = text.slice(0, 100).replace(/\n/g, ' ')
  const id = `result-${Math.random().toString(36).slice(2)}`
  const escaped = esc(text)
  return `<div class="tr-result" style="margin:4px 0">` +
    `<div class="tr-result-head" data-toggle="${id}" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:3px 8px;font-size:11px;font-family:monospace">` +
    `<span style="color:#27ae60">↩ ${esc(toolName)}</span>` +
    `<span style="color:#aaa">${esc(preview)}${text.length > 100 ? '…' : ''}</span>` +
    `<span style="color:#aaa;font-size:10px">▶</span>` +
    `</div>` +
    `<pre id="${id}" style="display:none;margin:4px 0 0 0;background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;white-space:pre-wrap">${escaped}</pre>` +
    `</div>`
}

function renderContentBlock(block: TranscriptContentBlock): string {
  if (block.kind === 'text') {
    return `<div class="tr-text" style="white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;color:#222">${esc(block.text)}</div>`
  }
  if (block.kind === 'tool_use') {
    return renderToolUseBlock(block.name, block.input)
  }
  if (block.kind === 'tool_result') {
    return renderToolResultBlock(block.toolName, block.text)
  }
  return ''
}

function renderEntry(entry: TranscriptEntry, idx: number): string {
  const time = formatTime(entry.timestamp)
  const contentHtml = entry.content.map(renderContentBlock).join('')

  if (entry.type === 'assistant') {
    return `<div class="tr-entry tr-assistant" data-idx="${idx}" style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0">` +
      `<div style="min-width:60px;color:#aaa;font-size:11px;font-family:monospace;padding-top:2px">${time}</div>` +
      `<div style="flex:1">` +
      `<div style="font-size:11px;font-weight:600;color:#3498db;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Agent</div>` +
      contentHtml +
      `</div>` +
      `</div>`
  }

  if (entry.type === 'user') {
    // User entries are mostly tool results and hook context — render compactly
    const hasOnlyToolResults = entry.content.every(b => b.kind === 'tool_result')
    if (hasOnlyToolResults) {
      return `<div class="tr-entry tr-tool-results" data-idx="${idx}" style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f8f8f8">` +
        `<div style="min-width:60px;color:#ccc;font-size:11px;font-family:monospace;padding-top:2px">${time}</div>` +
        `<div style="flex:1">${contentHtml}</div>` +
        `</div>`
    }
    return `<div class="tr-entry tr-user" data-idx="${idx}" style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f5f5f5">` +
      `<div style="min-width:60px;color:#aaa;font-size:11px;font-family:monospace;padding-top:2px">${time}</div>` +
      `<div style="flex:1">` +
      `<div style="font-size:11px;font-weight:600;color:#95a5a6;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Context</div>` +
      contentHtml +
      `</div>` +
      `</div>`
  }

  return ''
}

export function renderTranscript(entries: ReadonlyArray<TranscriptEntry>, total: number): string {
  if (entries.length === 0) {
    return html`<div style="padding:24px;color:#aaa">No transcript entries found.</div>`
  }

  const rows = entries.map((e, i) => renderEntry(e, i)).filter(Boolean).join('')

  return `<div style="padding:16px">` +
    `<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">` +
    `<input id="transcript-search" type="text" placeholder="Search transcript..." style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px" />` +
    `<label style="font-size:12px;color:#888;display:flex;align-items:center;gap:4px;cursor:pointer">` +
    `<input id="transcript-agent-only" type="checkbox" /> Agent messages only` +
    `</label>` +
    `<span id="transcript-count" style="color:#aaa;font-size:13px">${total} entries</span>` +
    `</div>` +
    `<div id="transcript-rows">${rows}</div>` +
    `</div>`
}

export function attachTranscriptListeners(): void {
  const searchInput = document.getElementById('transcript-search')
  const agentOnly = document.getElementById('transcript-agent-only')
  const rowsContainer = document.getElementById('transcript-rows')
  if (!rowsContainer) return

  // Toggle collapsible tool blocks
  rowsContainer.addEventListener('click', (e) => {
    const head = (e.target as HTMLElement).closest('[data-toggle]')
    if (!(head instanceof HTMLElement)) return
    const targetId = head.getAttribute('data-toggle')
    if (!targetId) return
    const target = document.getElementById(targetId)
    if (!target) return
    const isHidden = target.style.display === 'none'
    target.style.display = isHidden ? 'block' : 'none'
    const arrow = head.querySelector('span:last-child')
    if (arrow) arrow.textContent = isHidden ? '▼' : '▶'
  })

  function applyFilters(): void {
    const query = searchInput instanceof HTMLInputElement ? searchInput.value.toLowerCase() : ''
    const onlyAgent = agentOnly instanceof HTMLInputElement ? agentOnly.checked : false
    let visible = 0
    rowsContainer?.querySelectorAll<HTMLElement>('.tr-entry').forEach((row) => {
      const isAgent = row.classList.contains('tr-assistant')
      if (onlyAgent && !isAgent) {
        row.style.display = 'none'
        return
      }
      const text = row.textContent?.toLowerCase() ?? ''
      const show = !query || text.includes(query)
      row.style.display = show ? '' : 'none'
      if (show) visible++
    })
    const countEl = document.getElementById('transcript-count')
    const total = rowsContainer?.querySelectorAll('.tr-entry').length ?? 0
    if (countEl) countEl.textContent = `${visible} of ${total} entries`
  }

  searchInput?.addEventListener('input', applyFilters)
  agentOnly?.addEventListener('change', applyFilters)
}
