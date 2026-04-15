import type {
  TranscriptEntry, TranscriptResponse, SessionDetailDto 
} from '../api-client'
import { html } from '../render'
import type {
  InsightEntry, JournalEntry, StatePeriod 
} from './transcript-view-format'
import {
  stateForTimestamp, strOrEmpty, trimOrEmpty 
} from './transcript-view-format'
import {
  renderEntry, renderJournalAnnot, renderInsightAnnot 
} from './transcript-view-entry'
import {
  renderMinimap, renderToolFilterChips, renderAnalysis, renderKeyboardHelp 
} from './transcript-view-minimap'
import {
  applyFilters, downloadFile, exportMarkdown, flashMessage, highlightPair, navigateMessage 
} from './transcript-view-filter'

/** @riviere-role web-tbc */
export type TranscriptContext = {readonly session?: SessionDetailDto | undefined}

type TranscriptContent = {
  readonly rows: string
  readonly analysis: string
  readonly toolFilter: string
  readonly minimap: string
}

function interleaveJournalEntries(
  entries: ReadonlyArray<TranscriptEntry>,
  journalSorted: ReadonlyArray<JournalEntry>,
  periods: ReadonlyArray<StatePeriod>,
  sessionId: string | undefined,
): string {
  const cursor = { j: 0 }
  const parts: Array<string> = []
  for (const [i, entry] of entries.entries()) {
    const tEntry = Date.parse(entry.timestamp)
    while (cursor.j < journalSorted.length) {
      const j = journalSorted[cursor.j]
      if (j === undefined) { cursor.j += 1; continue }
      if (Date.parse(j.at) > tEntry) break
      parts.push(renderJournalAnnot(j))
      cursor.j += 1
    }
    parts.push(renderEntry(entry, i, stateForTimestamp(periods, entry.timestamp), sessionId))
  }
  while (cursor.j < journalSorted.length) {
    const j = journalSorted[cursor.j]
    cursor.j += 1
    if (j !== undefined) parts.push(renderJournalAnnot(j))
  }
  return parts.join('')
}

function buildTranscriptContent(resp: TranscriptResponse, ctx?: TranscriptContext): TranscriptContent {
  const session = ctx?.session
  const periods: ReadonlyArray<StatePeriod> = session?.statePeriods ?? []
  const journal: ReadonlyArray<JournalEntry> = session?.journalEntries ?? []
  const insights: ReadonlyArray<InsightEntry> = session?.insights ?? []
  const sessionId = session?.sessionId
  const topInsights = insights.slice(0, 3).map(renderInsightAnnot).join('')
  const journalSorted = [...journal].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const interleaved = interleaveJournalEntries(resp.entries, journalSorted, periods, sessionId)
  return {
    rows: topInsights + interleaved,
    analysis: renderAnalysis(resp),
    toolFilter: renderToolFilterChips(resp.toolCounts),
    minimap: renderMinimap(resp.entries, periods),
  }
}

function renderControls(): string {
  return `<div class="tr-controls">` +
    `<input id="transcript-search" type="text" placeholder="Search conversation... (use /regex/ for regex)" />` +
    `<label><input id="transcript-agent-only" type="checkbox" /> Assistant only</label>` +
    `<label><input id="transcript-text-only" type="checkbox" /> Text only</label>` +
    `<label><input id="transcript-errors-only" type="checkbox" /> Errors only</label>` +
    `<label><input id="transcript-hide-sidechain" type="checkbox" /> Hide sidechain</label>` +
    `<label><input id="transcript-incl-tools" type="checkbox" checked /> Match in tool output</label>` +
  `</div>`
}

function renderStream(resp: TranscriptResponse, content: TranscriptContent): string {
  const controls =
    `<span class="tr-bar-controls">` +
      `<button type="button" class="tr-bar-btn" id="transcript-export-md">Export .md</button>` +
      `<button type="button" class="tr-bar-btn" id="transcript-export-json">Export .json</button>` +
      `<button type="button" class="tr-bar-btn" id="transcript-kbd-toggle" title="Keyboard shortcuts (?)">⌨</button>` +
      `<span id="transcript-count">${resp.total} of ${resp.total} messages</span>` +
    `</span>`
  return `<div class="tr-section">` +
    `<div class="tr-section-bar"><span class="tr-caret">▼</span><span class="tr-title">Message Stream</span>${controls}</div>` +
    renderControls() +
    content.toolFilter +
    `<div class="tr-stream-layout">` +
      `<div class="tr-stream-col"><div id="transcript-rows" class="tr-rows">${content.rows}</div></div>` +
      content.minimap +
    `</div>` +
  `</div>${renderKeyboardHelp()}`
}

/** @riviere-role web-tbc */
export function renderTranscript(resp: TranscriptResponse, ctx?: TranscriptContext): string {
  if (resp.entries.length === 0) {
    return html`<div class="tr-wrap"><div class="tr-empty">No transcript entries found.</div></div>`
  }
  const content = buildTranscriptContent(resp, ctx)
  return `<div class="tr-wrap">${content.analysis}${renderStream(resp, content)}</div>`
}

function handleExpand(expand: HTMLElement): void {
  const id = expand.getAttribute('data-expand')
  if (id === null) return
  const box = document.getElementById(id)
  if (box === null) return
  const opened = box.classList.toggle('open')
  const current = strOrEmpty(expand.textContent)
  expand.textContent = opened ? 'Collapse' : current.replace(/^Collapse$/, 'Show all')
}

function handleGotoEvents(gotoEv: HTMLElement, e: Event): void {
  e.preventDefault()
  const ts = strOrEmpty(gotoEv.getAttribute('data-goto-events'))
  window.dispatchEvent(new CustomEvent('tr:goto-events', {detail: { timestamp: ts },}))
}

function handlePermalink(plink: HTMLAnchorElement, e: Event): void {
  e.preventDefault()
  const idx = plink.getAttribute('data-permalink')
  if (idx === null) return
  const hashPrefix = strOrEmpty(window.location.hash.split('#msg-')[0])
  const url = `${window.location.origin}${window.location.pathname}${hashPrefix}#msg-${idx}`
  navigator.clipboard.writeText(url).catch(() => undefined)
  flashMessage(`msg-${idx}`)
  history.replaceState(null, '', `#msg-${idx}`)
}

function toggleBody(head: HTMLElement): void {
  const targetId = head.getAttribute('data-toggle')
  if (targetId === null) return
  const body = document.getElementById(targetId)
  if (body === null) return
  const isOpen = body.classList.contains('open')
  body.classList.toggle('open', !isOpen)
  const arrow = head.querySelector('.tr-tool-arrow, .tr-result-arrow, .tr-thinking-arrow')
  if (arrow !== null) arrow.textContent = isOpen ? '▶' : '▼'
  const pairId = head.getAttribute('data-pair-src')
  if (pairId !== null) highlightPair(pairId)
}

function handleRowClick(e: Event): void {
  const t = e.target
  if (!(t instanceof HTMLElement)) return
  const expand = t.closest('[data-expand]')
  if (expand instanceof HTMLElement) {
    handleExpand(expand)
    return
  }
  const gotoEv = t.closest('[data-goto-events]')
  if (gotoEv instanceof HTMLElement) {
    handleGotoEvents(gotoEv, e)
    return
  }
  const plink = t.closest('[data-permalink]')
  if (plink instanceof HTMLAnchorElement) {
    handlePermalink(plink, e)
    return
  }
  const head = t.closest('[data-toggle]')
  if (head instanceof HTMLElement) toggleBody(head)
}

function attachFilterInputs(rowsContainer: HTMLElement): void {
  const doApply = (): void => applyFilters(rowsContainer)
  const ids = [
    'transcript-search',
    'transcript-agent-only',
    'transcript-text-only',
    'transcript-errors-only',
    'transcript-hide-sidechain',
    'transcript-incl-tools',
  ]
  for (const id of ids) {
    const el = document.getElementById(id)
    if (el === null) continue
    const event = el instanceof HTMLInputElement && el.type === 'text' ? 'input' : 'change'
    el.addEventListener(event, doApply)
  }
  document.querySelectorAll<HTMLElement>('.tr-tool-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active')
      doApply()
    })
  })
}

function handleMinimapClick(item: HTMLAnchorElement, e: Event): void {
  const idx = item.getAttribute('data-mm-idx')
  if (idx === null || idx.length === 0) {
    e.preventDefault()
    return
  }
  e.preventDefault()
  const row = document.getElementById(`msg-${idx}`)
  if (row !== null) {
    row.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    flashMessage(`msg-${idx}`)
  }
  document.querySelectorAll('.tr-mm-item.active, .tr-mm-transition.active').forEach(el => el.classList.remove('active'))
  item.classList.add('active')
}

function attachMinimap(): void {
  document.querySelectorAll<HTMLAnchorElement>('.tr-mm-item, .tr-mm-transition').forEach((item) => {
    item.addEventListener('click', (e) => handleMinimapClick(item, e))
  })
}

type ExportedEntry = {
  readonly idx: number
  readonly role: string
  readonly tools: ReadonlyArray<string>
  readonly hasError: boolean
  readonly tokens: number
  readonly text: string
}

function toExported(row: HTMLElement): ExportedEntry {
  return {
    idx: Number(row.getAttribute('data-idx')),
    role: strOrEmpty(row.getAttribute('data-role')),
    tools: strOrEmpty(row.getAttribute('data-tools')).split(/\s+/).filter(v => v.length > 0),
    hasError: row.getAttribute('data-has-error') === '1',
    tokens: Number(row.getAttribute('data-tokens')),
    text: trimOrEmpty(row.querySelector('.tr-entry-body')?.textContent),
  }
}

function attachExportButtons(rowsContainer: HTMLElement): void {
  const visibleRows = (): ReadonlyArray<HTMLElement> =>
    Array.from(rowsContainer.querySelectorAll<HTMLElement>('.tr-entry')).filter(r => r.style.display !== 'none')
  document.getElementById('transcript-export-md')?.addEventListener('click', () => {
    downloadFile('transcript.md', exportMarkdown(visibleRows()), 'text/markdown')
  })
  document.getElementById('transcript-export-json')?.addEventListener('click', () => {
    const items = visibleRows().map(toExported)
    downloadFile('transcript.json', JSON.stringify(items, null, 2), 'application/json')
  })
}

function toggleCheckbox(id: string, doApply: () => void): void {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLInputElement)) return
  el.checked = !el.checked
  doApply()
}

function scrollToFirst(): void {
  const first = document.querySelector<HTMLElement>('.tr-entry')
  if (first !== null) first.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

function scrollToLast(): void {
  const all = document.querySelectorAll<HTMLElement>('.tr-entry')
  const last = all[all.length - 1]
  if (last !== undefined) last.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

type KeyHandlerDeps = {
  readonly kbdHelp: HTMLElement | null
  readonly doApply: () => void
}

function handleNav(e: KeyboardEvent): boolean {
  if (e.key === 'j') { e.preventDefault(); navigateMessage(1); return true }
  if (e.key === 'k') { e.preventDefault(); navigateMessage(-1); return true }
  return false
}

function handleSearchFocus(e: KeyboardEvent): boolean {
  if (e.key !== '/') return false
  e.preventDefault()
  const s = document.getElementById('transcript-search')
  if (s instanceof HTMLInputElement) s.focus()
  return true
}

function handleToggles(e: KeyboardEvent, doApply: () => void): boolean {
  if (e.key === 'a') { toggleCheckbox('transcript-agent-only', doApply); return true }
  if (e.key === 't') { toggleCheckbox('transcript-text-only', doApply); return true }
  if (e.key === 'e') { toggleCheckbox('transcript-errors-only', doApply); return true }
  return false
}

function handleJumps(e: KeyboardEvent): boolean {
  if (e.key === 'g' && !e.shiftKey) { scrollToFirst(); return true }
  if (e.key === 'G' || (e.key === 'g' && e.shiftKey)) { scrollToLast(); return true }
  return false
}

function handleHelpKey(e: KeyboardEvent, kbdHelp: HTMLElement | null): boolean {
  if (e.key === '?') { kbdHelp?.classList.toggle('open'); return true }
  if (e.key === 'Escape') { kbdHelp?.classList.remove('open'); return true }
  return false
}

function makeKeyHandler(deps: KeyHandlerDeps): (e: KeyboardEvent) => void {
  return (e) => {
    const active = document.activeElement
    const inField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    if (inField && e.key !== 'Escape') return
    if (handleNav(e)) return
    if (handleSearchFocus(e)) return
    if (handleToggles(e, deps.doApply)) return
    if (handleJumps(e)) return
    handleHelpKey(e, deps.kbdHelp)
  }
}

function attachKeyboard(doApply: () => void): void {
  const kbdHelp = document.getElementById('tr-kbd-help')
  document.getElementById('transcript-kbd-toggle')?.addEventListener('click', () => {
    kbdHelp?.classList.toggle('open')
  })
  const onKey = makeKeyHandler({
    kbdHelp,
    doApply,
  })
  replaceKeydownHandler(onKey)
}

function replaceKeydownHandler(handler: (e: KeyboardEvent) => void): void {
  const holder: {value: EventListener | null} = keyHandlerHolder
  if (holder.value !== null) {
    document.removeEventListener('keydown', holder.value)
  }
  const listener: EventListener = (e) => {
    if (e instanceof KeyboardEvent) handler(e)
  }
  document.addEventListener('keydown', listener)
  holder.value = listener
}

const keyHandlerHolder: {value: EventListener | null} = { value: null }

function applyDeepLink(): void {
  const m = /#msg-(\d+)/.exec(window.location.hash)
  if (m === null) return
  const id = `msg-${m[1]}`
  setTimeout(() => {
    const el = document.getElementById(id)
    if (el === null) return
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    flashMessage(id)
  }, 50)
}

/** @riviere-role web-tbc */
export function attachTranscriptListeners(): void {
  const rowsContainer = document.getElementById('transcript-rows')
  if (rowsContainer === null) return
  rowsContainer.addEventListener('click', handleRowClick)
  attachFilterInputs(rowsContainer)
  attachMinimap()
  attachExportButtons(rowsContainer)
  attachKeyboard(() => applyFilters(rowsContainer))
  applyDeepLink()
}
