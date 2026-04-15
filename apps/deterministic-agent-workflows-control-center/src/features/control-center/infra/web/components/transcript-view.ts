import type { TranscriptEntry, TranscriptContentBlock } from '../api-client'
import { html, esc } from '../render'

function formatTime(iso: string): string {
  if (!iso) return ''
  return iso.slice(11, 19)
}

function renderToolUseBlock(name: string, input: Record<string, unknown>): string {
  const key = Object.keys(input)[0] ?? ''
  const val = key ? String(Object.values(input)[0] ?? '').slice(0, 60) : ''
  const preview = key ? `${key}: ${val}` : ''
  const fullJson = esc(JSON.stringify(input, null, 2))
  const id = `tool-${Math.random().toString(36).slice(2)}`
  return `<div class="tr-tool" style="margin:8px 0;border-left:3px solid #3498db">` +
    `<div class="tr-tool-head" data-toggle="${id}" style="cursor:pointer;display:flex;align-items:center;gap:8px;background:#ecf0f7;padding:8px 12px;font-size:12px;user-select:none">` +
    `<span style="color:#3498db;font-weight:600">⚙ ${esc(name)}</span>` +
    (preview ? `<span style="color:#888;font-family:monospace;font-size:11px">${esc(preview)}</span>` : '') +
    `<span style="color:#aaa;margin-left:auto;font-size:11px">▶</span>` +
    `</div>` +
    `<pre id="${id}" style="display:none;margin:0;background:#f9f9f9;border-bottom:3px solid #3498db;padding:12px;font-size:11px;overflow-x:auto;white-space:pre-wrap;max-height:200px;overflow-y:auto">${fullJson}</pre>` +
    `</div>`
}

function renderToolResultBlock(toolName: string, text: string): string {
  const preview = text.slice(0, 80).replace(/\n/g, ' ')
  const id = `result-${Math.random().toString(36).slice(2)}`
  const escaped = esc(text)
  return `<div class="tr-result" style="margin:8px 0;border-left:3px solid #27ae60">` +
    `<div class="tr-result-head" data-toggle="${id}" style="cursor:pointer;display:flex;align-items:center;gap:8px;background:#ecf7f0;padding:8px 12px;font-size:12px;user-select:none">` +
    `<span style="color:#27ae60;font-weight:600">↩ ${esc(toolName)}</span>` +
    `<span style="color:#888;font-size:11px">${esc(preview)}${text.length > 80 ? '…' : ''}</span>` +
    `<span style="color:#aaa;margin-left:auto;font-size:11px">▶</span>` +
    `</div>` +
    `<pre id="${id}" style="display:none;margin:0;background:#f9f9f9;border-bottom:3px solid #27ae60;padding:12px;font-size:11px;overflow-x:auto;white-space:pre-wrap;max-height:200px;overflow-y:auto">${escaped}</pre>` +
    `</div>`
}

function renderContentBlock(block: TranscriptContentBlock): string {
  if (block.kind === 'text') {
    return `<div class="tr-text" style="white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;color:#333;font-style:normal;font-weight:normal">${esc(block.text)}</div>`
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
    return `<div class="tr-entry tr-assistant" data-idx="${idx}" style="display:grid;grid-template-columns:80px 1fr;gap:16px;padding:16px 0;border-bottom:1px solid #e8e8e8">` +
      `<div style="display:flex;flex-direction:column;align-items:flex-start">` +
      `<div style="color:#3498db;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Agent</div>` +
      `<div style="color:#bbb;font-size:10px;font-family:monospace;margin-top:4px">${time}</div>` +
      `</div>` +
      `<div style="min-width:0">` +
      contentHtml +
      `</div>` +
      `</div>`
  }

  if (entry.type === 'user') {
    const hasOnlyToolResults = entry.content.every(b => b.kind === 'tool_result')
    return `<div class="tr-entry tr-user" data-idx="${idx}" style="display:grid;grid-template-columns:80px 1fr;gap:16px;padding:${hasOnlyToolResults ? 8 : 12}px 0;border-bottom:1px solid #f2f2f2">` +
      `<div style="display:flex;flex-direction:column;align-items:flex-start">` +
      `<div style="color:#999;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Context</div>` +
      `<div style="color:#ddd;font-size:10px;font-family:monospace;margin-top:4px">${time}</div>` +
      `</div>` +
      `<div style="min-width:0;${hasOnlyToolResults ? 'background:#fafafa;padding:8px;border-radius:3px' : ''}">` +
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

  return `<div style="padding:20px;max-width:100%">` +
    `<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap">` +
    `<input id="transcript-search" type="text" placeholder="Search conversation..." style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-style:normal" />` +
    `<label style="font-size:12px;color:#888;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none">` +
    `<input id="transcript-agent-only" type="checkbox" style="cursor:pointer" /> Agent only` +
    `</label>` +
    `<span id="transcript-count" style="color:#aaa;font-size:12px;font-family:monospace">${total} msgs</span>` +
    `</div>` +
    `<div id="transcript-rows" style="font-family:system-ui,-apple-system,sans-serif">${rows}</div>` +
    `</div>`
}

export function attachTranscriptListeners(): void {
  const searchInput = document.getElementById('transcript-search')
  const agentOnly = document.getElementById('transcript-agent-only')
  const rowsContainer = document.getElementById('transcript-rows')
  if (!rowsContainer) return

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
    if (countEl) countEl.textContent = `${visible} of ${total} msgs`
  }

  searchInput?.addEventListener('input', applyFilters)
  agentOnly?.addEventListener('change', applyFilters)
}
