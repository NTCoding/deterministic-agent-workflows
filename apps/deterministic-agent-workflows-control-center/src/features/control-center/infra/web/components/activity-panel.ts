import type { ActivityResponse, ActivityReport, PerStateActivity } from '../api-client'
import { esc } from '../render'

function stateCssClass(state: string): string {
  const s = state.toLowerCase()
  if (s.includes('spawn')) return 's-spawn'
  if (s.includes('plan')) return 's-plan'
  if (s.includes('respawn')) return 's-respawn'
  if (s.includes('dev')) return 's-dev'
  if (s.includes('review') && !s.includes('cr')) return 's-review'
  if (s.includes('commit')) return 's-commit'
  if (s === 'cr' || s.includes('code_review')) return 's-cr'
  if (s.includes('pr')) return 's-pr'
  if (s.includes('done') || s.includes('complete')) return 's-done'
  if (s.includes('block')) return 's-blocked'
  if (s.includes('feedback')) return 's-feedback'
  return 's-idle'
}

function shortenPath(p: string): string {
  if (p.length <= 70) return p
  const parts = p.split('/')
  if (parts.length <= 3) return p
  return `.../${parts.slice(-3).join('/')}`
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function summarise(r: ActivityReport): string {
  const bits: Array<string> = []
  if (r.totalToolCalls > 0) bits.push(`${r.totalToolCalls} tool call${r.totalToolCalls === 1 ? '' : 's'}`)
  if (r.bashTotal > 0) bits.push(`${r.bashTotal} bash`)
  if (r.filesTouchedTotal > 0) bits.push(`${r.filesTouchedTotal} file${r.filesTouchedTotal === 1 ? '' : 's'}`)
  if (r.filesEdited.length > 0) bits.push(`${r.filesEdited.reduce((a, b) => a + b.count, 0)} edit${r.filesEdited.length === 1 ? '' : 's'}`)
  if (r.filesWritten.length > 0) bits.push(`${r.filesWritten.reduce((a, b) => a + b.count, 0)} write${r.filesWritten.length === 1 ? '' : 's'}`)
  if (r.tasksDelegated.length > 0) bits.push(`${r.tasksDelegated.length} task${r.tasksDelegated.length === 1 ? '' : 's'}`)
  return bits.join(' · ') || 'no activity'
}

function renderToolCountsRow(r: ActivityReport): string {
  const entries = Object.entries(r.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 14)
  if (entries.length === 0) return ''
  const chips = entries.map(([name, n]) => `<span class="ac-tool-chip">${esc(name)} <span class="ac-tool-n">×${n}</span></span>`).join('')
  return `<div class="ac-chips">${chips}</div>`
}

function renderBashSection(r: ActivityReport): string {
  if (r.bashCommands.length === 0) return ''
  const rows = r.bashCommands.map(c =>
    `<div class="ac-row"><span class="ac-row-n">×${c.count}</span><code class="ac-cmd">${esc(c.command)}</code></div>`
  ).join('')
  const moreHint = r.bashTotal > r.bashCommands.length
    ? `<div class="ac-more">+${r.bashTotal - r.bashCommands.reduce((a, b) => a + b.count, 0)} more invocations</div>` : ''
  return `<div class="ac-sub"><div class="ac-sub-head">Bash <span class="ac-n">${r.bashTotal}</span></div>${rows}${moreHint}</div>`
}

function renderFileGroup(title: string, kind: 'edited' | 'written' | 'read', files: ReadonlyArray<{ path: string; count: number }>): string {
  if (files.length === 0) return ''
  const rows = files.map(f =>
    `<div class="ac-row ac-file-${kind}" title="${esc(f.path)}">` +
      `<span class="ac-row-n">${f.count > 1 ? `×${f.count}` : ''}</span>` +
      `<span class="ac-file-base">${esc(basenameOf(f.path))}</span>` +
      `<span class="ac-file-dir">${esc(shortenPath(f.path.replace(basenameOf(f.path), '')))}</span>` +
    `</div>`
  ).join('')
  return `<div class="ac-sub"><div class="ac-sub-head">${title} <span class="ac-n">${files.length}</span></div>${rows}</div>`
}

function renderSearchSection(label: string, items: ReadonlyArray<{ pattern: string; count: number }>): string {
  if (items.length === 0) return ''
  const rows = items.map(i =>
    `<div class="ac-row"><span class="ac-row-n">${i.count > 1 ? `×${i.count}` : ''}</span><code class="ac-cmd">${esc(i.pattern)}</code></div>`
  ).join('')
  return `<div class="ac-sub"><div class="ac-sub-head">${label} <span class="ac-n">${items.length}</span></div>${rows}</div>`
}

function renderTasksSection(r: ActivityReport): string {
  if (r.tasksDelegated.length === 0) return ''
  const rows = r.tasksDelegated.map(t =>
    `<div class="ac-row"><span class="ac-task-agent">${esc(t.subagent)}</span><span class="ac-task-desc">${esc(t.description)}</span></div>`
  ).join('')
  return `<div class="ac-sub"><div class="ac-sub-head">Tasks delegated <span class="ac-n">${r.tasksDelegated.length}</span></div>${rows}</div>`
}

function renderWebSection(r: ActivityReport): string {
  const parts: Array<string> = []
  if (r.webFetches.length > 0) {
    parts.push(`<div class="ac-sub"><div class="ac-sub-head">Web fetches <span class="ac-n">${r.webFetches.length}</span></div>` +
      r.webFetches.map(w => `<div class="ac-row"><span class="ac-row-n">${w.count > 1 ? `×${w.count}` : ''}</span><code class="ac-cmd">${esc(w.url)}</code></div>`).join('') +
      `</div>`)
  }
  if (r.webSearches.length > 0) {
    parts.push(`<div class="ac-sub"><div class="ac-sub-head">Web searches <span class="ac-n">${r.webSearches.length}</span></div>` +
      r.webSearches.map(w => `<div class="ac-row"><span class="ac-row-n">${w.count > 1 ? `×${w.count}` : ''}</span><code class="ac-cmd">${esc(w.url)}</code></div>`).join('') +
      `</div>`)
  }
  return parts.join('')
}

function renderReportBody(r: ActivityReport): string {
  if (r.totalToolCalls === 0) return `<div class="ac-empty">No tool activity recorded.</div>`
  return renderToolCountsRow(r) +
    `<div class="ac-cols">` +
      `<div class="ac-col">` +
        renderFileGroup('Files edited', 'edited', r.filesEdited) +
        renderFileGroup('Files written', 'written', r.filesWritten) +
        renderFileGroup('Files read', 'read', r.filesRead) +
      `</div>` +
      `<div class="ac-col">` +
        renderBashSection(r) +
        renderSearchSection('Grep patterns', r.grepSearches) +
        renderSearchSection('Glob patterns', r.globSearches) +
        renderTasksSection(r) +
        renderWebSection(r) +
      `</div>` +
    `</div>`
}

function renderPerStateRow(p: PerStateActivity, idx: number): string {
  const total = p.report.totalToolCalls
  const chip = `<span class="tr-state-chip ${stateCssClass(p.state)}">${esc(p.state)}</span>`
  const summary = `<span class="ac-state-summary">${esc(summarise(p.report))}</span>`
  const time = p.startedAt.slice(11, 19)
  return `<div class="ac-state-row${total === 0 ? ' ac-state-empty' : ''}" data-ac-state-idx="${idx}">` +
    `<div class="ac-state-head" data-ac-toggle="${idx}">` +
      `<span class="ac-state-arrow">${total === 0 ? '·' : '▶'}</span>` +
      chip +
      `<span class="ac-state-time">${esc(time)}</span>` +
      summary +
    `</div>` +
    (total > 0 ? `<div class="ac-state-body" id="ac-state-body-${idx}">${renderReportBody(p.report)}</div>` : '') +
  `</div>`
}

export function renderActivityPanel(resp: ActivityResponse): string {
  const overall = renderReportBody(resp.overall)
  const byState = resp.byState.length === 0
    ? ''
    : `<div class="ac-section">` +
        `<div class="ac-section-head">Activity by State <span class="ac-section-sub">(${resp.byState.length} transitions)</span></div>` +
        resp.byState.map((p, i) => renderPerStateRow(p, i)).join('') +
      `</div>`

  return `<div class="ac-wrap">` +
    `<div class="ac-section">` +
      `<div class="ac-section-head">What Happened <span class="ac-section-sub">(whole session)</span></div>` +
      overall +
    `</div>` +
    byState +
  `</div>`
}

export function attachActivityListeners(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('[data-ac-toggle]').forEach((head) => {
    head.addEventListener('click', () => {
      const idx = head.getAttribute('data-ac-toggle')
      const body = idx ? document.getElementById(`ac-state-body-${idx}`) : null
      if (!body) return
      const isOpen = body.classList.toggle('open')
      const arrow = head.querySelector('.ac-state-arrow')
      if (arrow) arrow.textContent = isOpen ? '▼' : '▶'
    })
  })
}
