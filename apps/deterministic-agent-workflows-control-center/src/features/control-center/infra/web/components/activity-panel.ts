import type {
  ActivityReport,
  ActivityResponse,
  PerStateActivity,
} from '../api-client'
import { esc } from '../render'

const STATE_PALETTE: ReadonlyArray<string> = [
  's-dev', 's-review', 's-commit', 's-pr', 's-feedback',
  's-spawn', 's-cr', 's-respawn', 's-done', 's-plan',
]

function stateCssClass(state: string): string {
  let hash = 0
  for (let i = 0; i < state.length; i++) {
    hash = ((hash << 5) - hash + state.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % STATE_PALETTE.length
  return STATE_PALETTE[idx] ?? 's-idle'
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function shortenPath(p: string): string {
  if (p.length <= 70) return p
  const parts = p.split('/')
  if (parts.length <= 3) return p
  return `.../${parts.slice(-3).join('/')}`
}

function formatTimeOnly(iso: string): string {
  if (!iso) return ''
  return iso.slice(11, 19)
}

function summarise(r: ActivityReport): string {
  const bits: Array<string> = []
  if (r.totalToolCalls > 0) bits.push(`${r.totalToolCalls} tool call${r.totalToolCalls === 1 ? '' : 's'}`)
  if (r.bashTotal > 0) bits.push(`${r.bashTotal} bash`)
  if (r.filesTouchedTotal > 0) bits.push(`${r.filesTouchedTotal} file${r.filesTouchedTotal === 1 ? '' : 's'}`)
  const edits = r.filesEdited.reduce((a, b) => a + b.count, 0)
  if (edits > 0) bits.push(`${edits} edit${edits === 1 ? '' : 's'}`)
  const writes = r.filesWritten.reduce((a, b) => a + b.count, 0)
  if (writes > 0) bits.push(`${writes} write${writes === 1 ? '' : 's'}`)
  if (r.tasksDelegated.length > 0) bits.push(`${r.tasksDelegated.length} task${r.tasksDelegated.length === 1 ? '' : 's'}`)
  return bits.join(' · ') || 'no activity'
}

function renderToolChips(r: ActivityReport): string {
  const entries = Object.entries(r.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 14)
  if (entries.length === 0) return ''
  const chips = entries.map(([name, n]) =>
    `<span class="ac-tool-chip">${esc(name)} <span class="ac-tool-n">×${n}</span></span>`
  ).join('')
  return `<div class="ac-chips">${chips}</div>`
}

type CollapseOpts = { readonly startOpen?: boolean }

function collapseSub(title: string, count: number, bodyHtml: string, opts: CollapseOpts = {}): string {
  if (bodyHtml === '') return ''
  const open = opts.startOpen === true
  const arrow = open ? '▼' : '▶'
  const bodyCls = open ? 'ac-sub-body open' : 'ac-sub-body'
  return `<div class="ac-sub">` +
    `<div class="ac-sub-head" data-ac-sub-toggle>` +
      `<span class="ac-sub-arrow">${arrow}</span>` +
      `<span class="ac-sub-title">${esc(title)}</span>` +
      `<span class="ac-n">${count}</span>` +
    `</div>` +
    `<div class="${bodyCls}">${bodyHtml}</div>` +
  `</div>`
}

function renderFileGroup(title: string, kind: 'edited' | 'written' | 'read', files: ReadonlyArray<{
  path: string;
  count: number 
}>, opts: CollapseOpts = {}): string {
  if (files.length === 0) return ''
  const rows = files.map(f =>
    `<div class="ac-row ac-file-${kind}" title="${esc(f.path)}">` +
      `<span class="ac-row-n">${f.count > 1 ? `×${f.count}` : ''}</span>` +
      `<span class="ac-file-base">${esc(basenameOf(f.path))}</span>` +
      `<span class="ac-file-dir">${esc(shortenPath(f.path.replace(basenameOf(f.path), '')))}</span>` +
    `</div>`
  ).join('')
  return collapseSub(title, files.length, rows, opts)
}

function renderBashSection(r: ActivityReport, opts: CollapseOpts = {}): string {
  if (r.bashCommands.length === 0) return ''
  const rows = r.bashCommands.map(c =>
    `<div class="ac-row"><span class="ac-row-n">×${c.count}</span><code class="ac-cmd">${esc(c.command)}</code></div>`
  ).join('')
  const shown = r.bashCommands.reduce((a, b) => a + b.count, 0)
  const moreHint = r.bashTotal > shown
    ? `<div class="ac-more">+${r.bashTotal - shown} more invocations</div>` : ''
  return collapseSub('Bash', r.bashTotal, rows + moreHint, opts)
}

function renderSearchSection(label: string, items: ReadonlyArray<{
  pattern: string;
  count: number 
}>): string {
  if (items.length === 0) return ''
  const rows = items.map(i =>
    `<div class="ac-row"><span class="ac-row-n">${i.count > 1 ? `×${i.count}` : ''}</span><code class="ac-cmd">${esc(i.pattern)}</code></div>`
  ).join('')
  return collapseSub(label, items.length, rows)
}

function renderTasksSection(r: ActivityReport): string {
  if (r.tasksDelegated.length === 0) return ''
  const rows = r.tasksDelegated.map(t =>
    `<div class="ac-row"><span class="ac-task-agent">${esc(t.subagent)}</span><span class="ac-task-desc">${esc(t.description)}</span></div>`
  ).join('')
  return collapseSub('Tasks delegated', r.tasksDelegated.length, rows)
}

function renderWebSection(r: ActivityReport): string {
  const parts: Array<string> = []
  if (r.webFetches.length > 0) {
    const rows = r.webFetches.map(w =>
      `<div class="ac-row"><span class="ac-row-n">${w.count > 1 ? `×${w.count}` : ''}</span><code class="ac-cmd">${esc(w.url)}</code></div>`
    ).join('')
    parts.push(collapseSub('Web fetches', r.webFetches.length, rows))
  }
  if (r.webSearches.length > 0) {
    const rows = r.webSearches.map(w =>
      `<div class="ac-row"><span class="ac-row-n">${w.count > 1 ? `×${w.count}` : ''}</span><code class="ac-cmd">${esc(w.url)}</code></div>`
    ).join('')
    parts.push(collapseSub('Web searches', r.webSearches.length, rows))
  }
  return parts.join('')
}

function renderOtherCalls(r: ActivityReport): string {
  const known = new Set(['bash', 'read', 'edit', 'multiedit', 'apply_patch', 'write', 'grep', 'glob', 'task', 'agent', 'webfetch', 'websearch'])
  const others = Object.entries(r.toolCounts)
    .filter(([name]) => !known.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
  if (others.length === 0) return ''
  const total = others.reduce((a, [, n]) => a + n, 0)
  const rows = others.map(([name, n]) =>
    `<div class="ac-row"><span class="ac-row-n">×${n}</span><code class="ac-cmd">${esc(name)}</code></div>`
  ).join('')
  return collapseSub('Other calls', total, rows)
}

function renderReportBody(r: ActivityReport): string {
  if (r.totalToolCalls === 0) return `<div class="ac-empty">No tool activity recorded.</div>`
  return renderToolChips(r) +
    `<div class="ac-body">` +
      renderFileGroup('Files edited', 'edited', r.filesEdited) +
      renderFileGroup('Files written', 'written', r.filesWritten) +
      renderFileGroup('Files read', 'read', r.filesRead) +
      renderBashSection(r) +
      renderSearchSection('Grep patterns', r.grepSearches) +
      renderSearchSection('Glob patterns', r.globSearches) +
      renderTasksSection(r) +
      renderWebSection(r) +
      renderOtherCalls(r) +
    `</div>`
}

function renderPerStateRow(p: PerStateActivity, idx: number): string {
  const total = p.report.totalToolCalls
  const chip = `<span class="tr-state-chip ${stateCssClass(p.state)}">${esc(p.state)}</span>`
  const summary = `<span class="ac-state-summary">${esc(summarise(p.report))}</span>`
  const time = formatTimeOnly(p.startedAt)
  const empty = total === 0
  return `<div class="ac-state-row${empty ? ' ac-state-empty' : ''}" data-ac-state-idx="${idx}">` +
    `<div class="ac-state-head"${empty ? '' : ` data-ac-toggle="${idx}"`}>` +
      `<span class="ac-state-arrow">${empty ? '·' : '▶'}</span>` +
      chip +
      `<span class="ac-state-time">${esc(time)}</span>` +
      summary +
    `</div>` +
    (empty ? '' : `<div class="ac-state-body">${renderReportBody(p.report)}</div>`) +
  `</div>`
}

/** @riviere-role web-tbc */
export function renderActivityPanel(resp: ActivityResponse): string {
  const overall = renderReportBody(resp.overall)
  const byState = resp.byState.length === 0
    ? '<div class="ac-empty">No state-level activity available.</div>'
    : resp.byState.map((p, i) => renderPerStateRow(p, i)).join('')

  return `<div class="ac-wrap">` +
    `<section class="ac-section">` +
      `<div class="ac-section-head">Overall activity <span class="ac-section-sub">(whole session)</span></div>` +
      overall +
    `</section>` +
    `<section class="ac-section">` +
      `<div class="ac-section-head">Activity by state <span class="ac-section-sub">(${resp.byState.length} transitions)</span></div>` +
      byState +
    `</section>` +
  `</div>`
}

/** @riviere-role web-tbc */
export function attachActivityListeners(container: HTMLElement): void {
  const stateToggles = container.querySelectorAll<HTMLElement>('[data-ac-toggle]')
  for (const head of stateToggles) {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling
      const arrow = head.querySelector<HTMLElement>('.ac-state-arrow')
      if (!(body instanceof HTMLElement) || !body.classList.contains('ac-state-body') || arrow === null) return
      const open = body.classList.toggle('open')
      arrow.textContent = open ? '▼' : '▶'
    })
  }

  const subToggles = container.querySelectorAll<HTMLElement>('[data-ac-sub-toggle]')
  for (const head of subToggles) {
    head.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const body = head.nextElementSibling
      const arrow = head.querySelector<HTMLElement>('.ac-sub-arrow')
      if (!(body instanceof HTMLElement) || arrow === null) return
      const open = body.classList.toggle('open')
      arrow.textContent = open ? '▼' : '▶'
    })
  }
}
