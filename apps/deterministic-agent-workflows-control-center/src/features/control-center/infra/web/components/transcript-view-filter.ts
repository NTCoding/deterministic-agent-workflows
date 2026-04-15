import {
  lowerOrEmpty, strOrEmpty, trimOrEmpty 
} from './transcript-view-format'

type FilterState = {
  readonly query: string
  readonly regex: RegExp | null
  readonly assistantOnly: boolean
  readonly textOnly: boolean
  readonly errorsOnly: boolean
  readonly hideSidechain: boolean
  readonly matchInTools: boolean
  readonly toolFilter: ReadonlySet<string>
}

function checked(id: string): boolean {
  const el = document.getElementById(id)
  return el instanceof HTMLInputElement ? el.checked : false
}

function searchValue(): string {
  const el = document.getElementById('transcript-search')
  return el instanceof HTMLInputElement ? el.value : ''
}

function buildRegex(pattern: string, flagsRaw: string): RegExp | null {
  try {
    const flags = flagsRaw.replaceAll(/[gy]/g, '')
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function parseRegex(searchVal: string): {
  readonly regex: RegExp | null;
  readonly query: string
} {
  const rxMatch = /^\/(.+)\/([gimsuy]*)$/.exec(searchVal)
  if (rxMatch?.[1] === undefined) return {
    regex: null,
    query: searchVal.toLowerCase(),
  }
  const regex = buildRegex(rxMatch[1], rxMatch[2] ?? 'i')
  return regex === null ? {
    regex: null,
    query: searchVal.toLowerCase(),
  } : {
    regex,
    query: '',
  }
}

function activeChips(): ReadonlyArray<string> {
  return Array.from(document.querySelectorAll<HTMLElement>('.tr-tool-filter-chip.active'))
    .map(el => strOrEmpty(el.getAttribute('data-tool-chip')))
    .filter(v => v.length > 0)
}

function getFilterState(): FilterState {
  const parsed = parseRegex(searchValue())
  return {
    query: parsed.query,
    regex: parsed.regex,
    assistantOnly: checked('transcript-agent-only'),
    textOnly: checked('transcript-text-only'),
    errorsOnly: checked('transcript-errors-only'),
    hideSidechain: checked('transcript-hide-sidechain'),
    matchInTools: checked('transcript-incl-tools'),
    toolFilter: new Set(activeChips()),
  }
}

function rowTextForMatch(row: HTMLElement, includeTools: boolean): string {
  if (includeTools) return lowerOrEmpty(row.textContent)
  const clone = row.cloneNode(true)
  if (!(clone instanceof HTMLElement)) return ''
  clone.querySelectorAll('.tr-tool, .tr-result').forEach(el => el.remove())
  return lowerOrEmpty(clone.textContent)
}

function passesBasicFilters(row: HTMLElement, f: FilterState): boolean {
  const isAgent = row.classList.contains('tr-assistant')
  const isSidechain = row.getAttribute('data-sidechain') === '1'
  const hasError = row.getAttribute('data-has-error') === '1'
  if (f.assistantOnly && !isAgent) return false
  if (f.hideSidechain && isSidechain) return false
  if (f.errorsOnly && !hasError) return false
  if (f.toolFilter.size === 0) return true
  const tools = strOrEmpty(row.getAttribute('data-tools')).split(/\s+/).filter(v => v.length > 0)
  return tools.some(t => f.toolFilter.has(t))
}

function passesTextFilter(text: string, f: FilterState): boolean {
  if (f.regex !== null) return f.regex.test(text)
  if (f.query.length > 0) return text.includes(f.query)
  return true
}

function toggleChildrenDisplay(row: HTMLElement, hide: boolean): void {
  row.querySelectorAll<HTMLElement>('.tr-tool, .tr-result').forEach((el) => {
    el.style.display = hide ? 'none' : ''
  })
}

function applyRow(row: HTMLElement, f: FilterState): boolean {
  if (!passesBasicFilters(row, f)) {
    row.style.display = 'none'
    return false
  }
  const show = passesTextFilter(rowTextForMatch(row, f.matchInTools), f)
  row.style.display = show ? '' : 'none'
  if (show) toggleChildrenDisplay(row, f.textOnly)
  return show
}

function syncMinimap(): void {
  document.querySelectorAll<HTMLElement>('.tr-mm-item, .tr-mm-transition').forEach((item) => {
    const idx = item.getAttribute('data-mm-idx')
    const row = idx !== null && idx.length > 0 ? document.getElementById(`msg-${idx}`) : null
    item.style.display = row !== null && row.style.display !== 'none' ? '' : 'none'
  })
}

/** @riviere-role web-tbc */
export function applyFilters(rowsContainer: HTMLElement): void {
  const f = getFilterState()
  const rows = rowsContainer.querySelectorAll<HTMLElement>('.tr-entry')
  const visible = Array.from(rows).reduce((n, row) => n + (applyRow(row, f) ? 1 : 0), 0)
  const countEl = document.getElementById('transcript-count')
  if (countEl !== null) countEl.textContent = `${visible} of ${rows.length} messages`
  syncMinimap()
}

/** @riviere-role web-tbc */
export function flashMessage(id: string): void {
  const row = document.getElementById(id)
  if (row === null) return
  row.classList.add('tr-flash')
  setTimeout(() => row.classList.remove('tr-flash'), 1100)
}

function roleAttr(row: HTMLElement): string {
  const attr = row.getAttribute('data-role')
  if (attr === null) return 'other'
  return attr
}

/** @riviere-role web-tbc */
export function exportMarkdown(entries: ReadonlyArray<HTMLElement>): string {
  return entries.map(row => {
    const role = roleAttr(row)
    const tokens = strOrEmpty(row.getAttribute('data-tokens'))
    const head = row.querySelector('.tr-entry-head')
    const time = trimOrEmpty(head?.querySelector('.tr-time')?.textContent)
    const body = trimOrEmpty(row.querySelector('.tr-entry-body')?.textContent)
    const tokenSuffix = tokens === '0' ? '' : ` (${tokens} tokens)`
    return `## ${role.toUpperCase()} — ${time}${tokenSuffix}\n\n${body}\n`
  }).join('\n---\n\n')
}

/** @riviere-role web-tbc */
export function downloadFile(name: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function findCurrentIdx(rows: ReadonlyArray<HTMLElement>, viewportCenter: number): number {
  const above = rows.filter(row => row.getBoundingClientRect().top <= viewportCenter)
  return Math.max(0, above.length - 1)
}

/** @riviere-role web-tbc */
export function navigateMessage(delta: number): void {
  const all = Array.from(document.querySelectorAll<HTMLElement>('.tr-entry')).filter(r => r.style.display !== 'none')
  if (all.length === 0) return
  const currentIdx = findCurrentIdx(all, window.innerHeight / 2)
  const target = all[Math.max(0, Math.min(all.length - 1, currentIdx + delta))]
  if (target === undefined) return
  target.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
  target.classList.add('tr-flash')
  setTimeout(() => target.classList.remove('tr-flash'), 1100)
}

/** @riviere-role web-tbc */
export function highlightPair(toolUseId: string): void {
  if (toolUseId.length === 0) return
  document.querySelectorAll<HTMLElement>('.tr-pair-hl').forEach(el => el.classList.remove('tr-pair-hl'))
  const use = document.querySelector<HTMLElement>(`.tr-tool[data-tool-id="${CSS.escape(toolUseId)}"]`)
  const result = document.querySelector<HTMLElement>(`.tr-result[data-tool-use-id="${CSS.escape(toolUseId)}"]`)
  if (use !== null) use.classList.add('tr-pair-hl')
  if (result !== null) result.classList.add('tr-pair-hl')
  const target = result ?? use
  if (target !== null) target.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  })
  setTimeout(() => {
    if (use !== null) use.classList.remove('tr-pair-hl')
    if (result !== null) result.classList.remove('tr-pair-hl')
  }, 1800)
}
