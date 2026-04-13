import type { EventDto } from '../api-client'
import {
  html, formatTime, esc, stateBadge 
} from '../render'
import {
  asHtmlElement,
  asInputElement,
  getDatasetValue,
  getOptionalElement,
  getTextContent,
  readWindowValue,
} from '../dom'

function categorizeEvent(type: string): string {
  if (type === 'transitioned') return 'transition'
  if (type === 'journal-entry') return 'journal'
  if (type.startsWith('agent-') || type === 'identity-verified' || type === 'context-requested') return 'agent'
  if (type.includes('denied') || type.includes('allowed') || type.includes('permission')) return 'permission'
  return 'other'
}

function extractOutcome(event: EventDto): string | undefined {
  if (event.denied === true) return 'denied'
  if (event.denied === false) return 'approved'
  return undefined
}

function renderLogEntry(event: EventDto, index: number): string {
  const outcome = extractOutcome(event)
  const category = categorizeEvent(event.type)
  const time = formatTime(event.at)
  const rowClasses = [
    'le',
    outcome === 'denied' ? 'denied' : '',
    category === 'journal' ? 'journal' : '',
  ].filter(Boolean).join(' ')

  const outcomeHtml = outcome
    ? html`<span class="le-outcome ${outcome}">${outcome.toUpperCase()}</span>`
    : ''

  const detailHtml = event.detail
    ? html`<span class="le-fields"><span class="ev-f"><span class="ev-fv">${esc(event.detail)}</span></span></span>`
    : ''

  return html`<div class="${rowClasses}" data-idx="${index}" data-cat="${category}" data-state="${esc(event.state)}" data-outcome="${outcome ?? 'none'}">` +
    html`<span class="le-time">${time}</span>` +
    stateBadge(event.state) +
    html`<span class="le-name">${esc(event.type)}</span>` +
    outcomeHtml + detailHtml +
    `</div>`
}

type FacetCounts = {
  cat: Record<string, number>
  state: Record<string, number>
  outcome: Record<string, number>
}

function isEventDtoArray(value: unknown): value is Array<EventDto> {
  return Array.isArray(value)
}

function buildFacetCounts(events: Array<EventDto>): FacetCounts {
  const cat: Record<string, number> = {}
  const state: Record<string, number> = {}
  const outcome: Record<string, number> = {}

  for (const event of events) {
    const c = categorizeEvent(event.type)
    cat[c] = (cat[c] ?? 0) + 1
    state[event.state] = (state[event.state] ?? 0) + 1
    const o = extractOutcome(event)
    if (o) outcome[o] = (outcome[o] ?? 0) + 1
  }

  return {
    cat,
    state,
    outcome 
  }
}

function renderFacetGroup(title: string, dimension: string, counts: Record<string, number>, total: number): string {
  const items = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([value, count]) => {
      const pct = (count / total) * 100
      return html`<div class="facet-item" data-dimension="${dimension}" data-value="${esc(value)}">` +
        html`<span>${esc(value)}</span>` +
        html`<div class="facet-bar"><div class="facet-bar-fill" style="width:${pct}%"></div></div>` +
        html`<span class="facet-ct">${count}</span></div>`
    }).join('')
  return html`<div class="facet-group"><div class="facet-title">${esc(title)}</div>${items}</div>`
}

/** @riviere-role web-tbc */
export function renderEventStream(events: Array<EventDto>, total: number): string {
  const facets = buildFacetCounts(events)
  const logEntries = events.map((e, i) => renderLogEntry(e, i)).join('')

  const sidebar = renderFacetGroup('Category', 'cat', facets.cat, events.length) +
    renderFacetGroup('State', 'state', facets.state, events.length) +
    renderFacetGroup('Outcome', 'outcome', facets.outcome, events.length)

  return html`<div class="log-explorer">` +
    html`<div class="log-search"><input type="text" placeholder="Search events..." id="log-search-input"><span class="result-count" id="log-count">${total} events</span></div>` +
    html`<div class="log-facets">${sidebar}</div>` +
    html`<div class="log-entries" id="log-entries">${logEntries}</div>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function attachEventStreamListeners(): void {
  const searchInput = getOptionalElement(document, '#log-search-input', asInputElement)
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase()
      const entries = document.querySelectorAll('#log-entries .le')
      const visibleState = { count: 0 }
      entries.forEach((el) => {
        const match = !query || getTextContent(el).toLowerCase().includes(query)
        if (asHtmlElement(el)) {
          el.classList.toggle('hidden', !match)
        }
        if (match) visibleState.count += 1
      })
      const countEl = document.getElementById('log-count')
      if (countEl) countEl.textContent = `${visibleState.count} events`
    })
  }

  document.querySelectorAll('.facet-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (!asHtmlElement(el)) return
      const dimension = getDatasetValue(el, 'dimension')
      const value = getDatasetValue(el, 'value')
      if (dimension === undefined || value === undefined) return
      el.classList.toggle('active')
      filterByFacets(dimension, value)
    })
  })

  document.querySelectorAll('#log-entries .le').forEach((el) => {
    el.addEventListener('click', () => {
      const wasExpanded = el.classList.contains('expanded')
      document.querySelectorAll('#log-entries .le.expanded').forEach((prev) => {
        prev.classList.remove('expanded')
        const detail = prev.querySelector('.le-detail')
        if (detail) prev.removeChild(detail)
      })
      if (wasExpanded) return
      if (!asHtmlElement(el)) return
      const idxValue = getDatasetValue(el, 'idx')
      if (idxValue === undefined) return
      const idx = parseInt(idxValue, 10)
      const storedEvents = readWindowValue('__events', isEventDtoArray)
      if (!storedEvents?.[idx]) return
      const evt = storedEvents[idx]
      if (!evt) return
      const payload = evt.payload
      const displayFields: Array<[string, string]> = []
      for (const [k, v] of Object.entries(payload)) {
        if (k === 'type' || k === 'at') continue
        displayFields.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
      }
      const fieldHtml = displayFields.map(([k, v]) =>
        `<span class="ev-f"><span class="ev-fk">${esc(k)}</span> <span class="ev-fv">${esc(v)}</span></span>`,
      ).join('')
      const div = document.createElement('div')
      div.className = 'le-detail'
      div.innerHTML = fieldHtml
      el.appendChild(div)
      el.classList.add('expanded')
    })
  })
}

const activeFacets: Record<string, Set<string>> = {}

function filterByFacets(dimension: string, value: string): void {
  activeFacets[dimension] ??= new Set()
  const set = activeFacets[dimension]
  if (set.has(value)) {
    set.delete(value)
    if (set.size === 0) delete activeFacets[dimension]
  } else {
    set.add(value)
  }
  applyFilters()
}

function applyFilters(): void {
  const entries = document.querySelectorAll('#log-entries .le')
  const searchInput = getOptionalElement(document, '#log-search-input', asInputElement)
  const searchValue = searchInput?.value
  const search = searchValue === undefined ? '' : searchValue.toLowerCase()
  const visibleState = { count: 0 }

  entries.forEach((le) => {
    const state = { show: true }
    for (const dim in activeFacets) {
      const attr = asHtmlElement(le) ? getDatasetValue(le, dim) : undefined
      const facetSet = activeFacets[dim]
      if (!attr || !facetSet?.has(attr)) {
        state.show = false
        break
      }
    }
    if (state.show && search) {
      state.show = getTextContent(le).toLowerCase().includes(search)
    }
    if (asHtmlElement(le)) {
      le.classList.toggle('hidden', !state.show)
    }
    if (state.show) visibleState.count += 1
  })

  const countEl = document.getElementById('log-count')
  if (countEl) countEl.textContent = `${visibleState.count} events`
}
