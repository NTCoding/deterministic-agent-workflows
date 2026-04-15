import type { EventDto } from '../api-client'
import { html, esc, formatTimeOnly } from '../render'
import { storeWindowValue, readWindowValue } from '../dom'

// Extracts a human-readable summary from an event
export function formatEventSummary(event: EventDto): string {
  const p = event.payload
  switch (event.type) {
    case 'transitioned':
      return `→ ${String(p['to'] ?? '')}  (was ${String(p['from'] ?? '')})`
    case 'journal-entry':
      return String(p['content'] ?? '')
    case 'bash-allowed':
      return `$ ${String(p['command'] ?? p['cmd'] ?? '')}`
    case 'bash-denied':
      return `DENIED: $ ${String(p['command'] ?? p['cmd'] ?? '')}`
    case 'write-allowed':
      return `write ${String(p['path'] ?? p['file'] ?? '')}`
    case 'write-denied':
      return `DENIED: write ${String(p['path'] ?? p['file'] ?? '')}`
    case 'agent-registered':
      return `Agent registered: ${String(p['agentName'] ?? p['agent_type'] ?? '')}`
    case 'session-started':
      return `Session started in state ${String(p['currentState'] ?? '')}`
    case 'identity-verified':
      return `Identity verified (${String(p['status'] ?? '')})`
    case 'context-requested':
      return `Context requested`
    default:
      return event.type
  }
}

function agentLabel(event: EventDto): string {
  const p = event.payload
  const name = p['agentName'] ?? p['agent_type'] ?? p['agentType'] ?? null
  return name ? esc(String(name)) : '<span style="color:#aaa">—</span>'
}

function typeBadge(type: string): string {
  const color: Record<string, string> = {
    'transitioned':    '#3498db',
    'journal-entry':   '#9b59b6',
    'bash-allowed':    '#2ecc71',
    'bash-denied':     '#e74c3c',
    'write-allowed':   '#27ae60',
    'write-denied':    '#c0392b',
    'session-started': '#95a5a6',
    'agent-registered':'#1abc9c',
  }
  const bg = color[type] ?? '#7f8c8d'
  const short = type.length > 18 ? type.slice(0, 17) + '…' : type
  return `<span style="display:inline-block;background:${bg};color:#fff;border-radius:3px;padding:1px 6px;font-size:10px;font-family:monospace;white-space:nowrap">${esc(short)}</span>`
}

export function renderTranscript(events: ReadonlyArray<EventDto>, total: number): string {
  storeWindowValue('__transcriptEvents', events)

  const rows = events.map((evt, idx) => {
    const time = formatTimeOnly(evt.at)
    const badge = typeBadge(evt.type)
    const agent = agentLabel(evt)
    const summary = esc(formatEventSummary(evt))
    return `<div class="tr-row" data-idx="${idx}" style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;font-size:13px;align-items:baseline">` +
      `<span style="color:#aaa;font-family:monospace;white-space:nowrap;min-width:60px">${time}</span>` +
      `<span style="min-width:160px">${badge}</span>` +
      `<span style="min-width:100px;color:#555">${agent}</span>` +
      `<span style="flex:1;color:#333">${summary}</span>` +
      `</div>`
  }).join('')

  return html`<div style="padding:16px">` +
    html`<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">` +
    html`<input id="transcript-search" type="text" placeholder="Search transcript..." style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px" />` +
    html`<span id="transcript-count" style="color:#aaa;font-size:13px">${total} events</span>` +
    `</div>` +
    `<div id="transcript-rows">${rows}</div>` +
    `</div>`
}

function isEventDtoArray(v: unknown): v is ReadonlyArray<EventDto> {
  return Array.isArray(v)
}

export function attachTranscriptListeners(): void {
  const searchInput = document.getElementById('transcript-search')
  const rowsContainer = document.getElementById('transcript-rows')
  if (!(searchInput instanceof HTMLInputElement) || !rowsContainer) return

  const events = readWindowValue('__transcriptEvents', isEventDtoArray) ?? []

  // Expand/collapse on click
  rowsContainer.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.tr-row')
    if (!(row instanceof HTMLElement)) return
    const existing = row.nextElementSibling
    if (existing?.classList.contains('tr-detail')) {
      existing.remove()
      return
    }
    const idx = parseInt(row.getAttribute('data-idx') ?? '-1', 10)
    const evt = events[idx]
    if (!evt) return
    const fields = Object.entries(evt.payload)
      .filter(([k]) => k !== 'type' && k !== 'at')
      .map(([k, v]) => `<div style="display:flex;gap:8px;padding:2px 0"><span style="color:#aaa;min-width:120px;font-family:monospace;font-size:11px">${esc(k)}</span><span style="color:#333;font-size:11px;word-break:break-all">${esc(JSON.stringify(v))}</span></div>`)
      .join('')
    const detail = document.createElement('div')
    detail.className = 'tr-detail'
    detail.style.cssText = 'background:#f9f9f9;padding:8px 12px;border-bottom:1px solid #f0f0f0;margin-left:72px'
    detail.innerHTML = fields || '<span style="color:#aaa;font-size:11px">no payload fields</span>'
    row.after(detail)
  })

  // Search filter
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase()
    rowsContainer.querySelectorAll<HTMLElement>('.tr-row').forEach((row, idx) => {
      const evt = events[idx]
      if (!evt) return
      const text = (formatEventSummary(evt) + ' ' + evt.type + ' ' + JSON.stringify(evt.payload)).toLowerCase()
      row.style.display = query === '' || text.includes(query) ? '' : 'none'
      const detail = row.nextElementSibling
      if (detail?.classList.contains('tr-detail')) {
        (detail as HTMLElement).style.display = row.style.display
      }
    })
    const visible = rowsContainer.querySelectorAll<HTMLElement>('.tr-row:not([style*="none"])').length
    const countEl = document.getElementById('transcript-count')
    if (countEl) countEl.textContent = `${visible} of ${events.length} events`
  })
}
