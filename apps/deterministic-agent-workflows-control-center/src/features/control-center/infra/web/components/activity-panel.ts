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

function hashState(state: string): number {
  const seed = { hash: 0 }
  for (const ch of state) {
    seed.hash = (Math.imul(seed.hash, 31) + ch.charCodeAt(0)) | 0
  }
  return Math.abs(seed.hash)
}

function stateCssClass(state: string): string {
  return STATE_PALETTE[hashState(state) % STATE_PALETTE.length] ?? 's-idle'
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
  return iso ? iso.slice(11, 19) : ''
}

function plural(n: number, word: string): string {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`
}

function sumCounts(items: ReadonlyArray<{readonly count: number}>): number {
  return items.reduce((total, item) => total + item.count, 0)
}

function summariseBits(r: ActivityReport): ReadonlyArray<string> {
  return [
    r.totalToolCalls > 0 ? plural(r.totalToolCalls, 'tool call') : '',
    r.bashTotal > 0 ? `${r.bashTotal} bash` : '',
    r.filesTouchedTotal > 0 ? plural(r.filesTouchedTotal, 'file') : '',
    sumCounts(r.filesEdited) > 0 ? plural(sumCounts(r.filesEdited), 'edit') : '',
    sumCounts(r.filesWritten) > 0 ? plural(sumCounts(r.filesWritten), 'write') : '',
    r.tasksDelegated.length > 0 ? plural(r.tasksDelegated.length, 'task') : '',
  ].filter(bit => bit.length > 0)
}

function summarise(r: ActivityReport): string {
  const bits = summariseBits(r)
  return bits.length === 0 ? 'no activity' : bits.join(' · ')
}

function renderToolChip(entry: readonly [string, number]): string {
  const [name, count] = entry
  const countMarkup = `<span class="ac-tool-n">×${count}</span>`
  return `<span class="ac-tool-chip">${esc(name)} ${countMarkup}</span>`
}

function renderToolChips(r: ActivityReport): string {
  const entries = Object.entries(r.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 14)
  if (entries.length === 0) return ''
  return `<div class="ac-chips">${entries.map(renderToolChip).join('')}</div>`
}

type CollapseOpts = {readonly startOpen?: boolean}

function collapseSub(title: string, count: number, bodyHtml: string, opts: CollapseOpts = {}): string {
  if (bodyHtml === '') return ''
  const open = opts.startOpen === true
  const arrow = open ? '▼' : '▶'
  const bodyCls = open ? 'ac-sub-body open' : 'ac-sub-body'
  const header =
    `<div class="ac-sub-head" data-ac-sub-toggle>` +
      `<span class="ac-sub-arrow">${arrow}</span>` +
      `<span class="ac-sub-title">${esc(title)}</span>` +
      `<span class="ac-n">${count}</span>` +
    `</div>`
  return `<div class="ac-sub">${header}<div class="${bodyCls}">${bodyHtml}</div></div>`
}

function renderCountBadge(count: number): string {
  return count > 1 ? `×${count}` : ''
}

function renderFileRow(kind: string, file: {
  readonly path: string;
  readonly count: number
}): string {
  const countBadge = renderCountBadge(file.count)
  const base = esc(basenameOf(file.path))
  const dir = esc(shortenPath(file.path.replace(basenameOf(file.path), '')))
  return `<div class="ac-row ac-file-${kind}" title="${esc(file.path)}">` +
    `<span class="ac-row-n">${countBadge}</span>` +
    `<span class="ac-file-base">${base}</span>` +
    `<span class="ac-file-dir">${dir}</span>` +
  `</div>`
}

function renderFileGroup(
  title: string,
  kind: 'edited' | 'written' | 'read',
  files: ReadonlyArray<{
    readonly path: string;
    readonly count: number
  }>,
  opts: CollapseOpts = {},
): string {
  if (files.length === 0) return ''
  const rows = files.map(file => renderFileRow(kind, file)).join('')
  return collapseSub(title, files.length, rows, opts)
}

function renderBashRow(cmd: {
  readonly command: string;
  readonly count: number
}): string {
  return `<div class="ac-row"><span class="ac-row-n">×${cmd.count}</span><code class="ac-cmd">${esc(cmd.command)}</code></div>`
}

function renderBashSection(r: ActivityReport, opts: CollapseOpts = {}): string {
  if (r.bashCommands.length === 0) return ''
  const rows = r.bashCommands.map(renderBashRow).join('')
  const shown = sumCounts(r.bashCommands)
  const more = r.bashTotal > shown ? `<div class="ac-more">+${r.bashTotal - shown} more invocations</div>` : ''
  return collapseSub('Bash', r.bashTotal, rows + more, opts)
}

function renderWorkflowSection(r: ActivityReport): string {
  if (r.workflowCommands.length === 0) return ''
  const rows = r.workflowCommands.map(renderBashRow).join('')
  return collapseSub('Workflow commands', r.workflowCommands.length, rows)
}

function renderFailedRow(cmd: {
  readonly toolName: string;
  readonly command: string;
  readonly output: string;
  readonly count: number;
}): string {
  const badge = renderCountBadge(cmd.count)
  return `<div class="ac-row ac-row-failed" title="${esc(cmd.output)}">` +
    `<span class="ac-row-n">${badge}</span>` +
    `<span class="ac-failed-tool">${esc(cmd.toolName)}</span>` +
    `<code class="ac-cmd">${esc(cmd.command)}</code>` +
    `<span class="ac-failed-output">${esc(cmd.output.slice(0, 60))}${cmd.output.length > 60 ? '...' : ''}</span>` +
    `</div>`
}

function renderFailedSection(r: ActivityReport): string {
  if (r.failedCommands.length === 0) return ''
  const rows = r.failedCommands.map(renderFailedRow).join('')
  return collapseSub('Failed commands', r.failedCommands.length, rows)
}

function renderPatternRow(item: {
  readonly pattern: string;
  readonly count: number
}): string {
  const badge = renderCountBadge(item.count)
  return `<div class="ac-row"><span class="ac-row-n">${badge}</span><code class="ac-cmd">${esc(item.pattern)}</code></div>`
}

function renderSearchSection(
  label: string,
  items: ReadonlyArray<{
    readonly pattern: string;
    readonly count: number
  }>,
): string {
  if (items.length === 0) return ''
  return collapseSub(label, items.length, items.map(renderPatternRow).join(''))
}

function renderTaskRow(task: {
  readonly subagent: string;
  readonly description: string
}): string {
  return `<div class="ac-row"><span class="ac-task-agent">${esc(task.subagent)}</span><span class="ac-task-desc">${esc(task.description)}</span></div>`
}

function renderTasksSection(r: ActivityReport): string {
  if (r.tasksDelegated.length === 0) return ''
  return collapseSub('Tasks delegated', r.tasksDelegated.length, r.tasksDelegated.map(renderTaskRow).join(''))
}

function renderUrlRow(w: {
  readonly url: string;
  readonly count: number
}): string {
  const badge = renderCountBadge(w.count)
  return `<div class="ac-row"><span class="ac-row-n">${badge}</span><code class="ac-cmd">${esc(w.url)}</code></div>`
}

function renderWebSection(r: ActivityReport): string {
  const parts: Array<string> = []
  if (r.webFetches.length > 0) {
    parts.push(collapseSub('Web fetches', r.webFetches.length, r.webFetches.map(renderUrlRow).join('')))
  }
  if (r.webSearches.length > 0) {
    parts.push(collapseSub('Web searches', r.webSearches.length, r.webSearches.map(renderUrlRow).join('')))
  }
  return parts.join('')
}

const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  'bash', 'read', 'edit', 'multiedit', 'apply_patch', 'write', 'grep', 'glob', 'task', 'agent', 'webfetch', 'websearch',
])

function renderOtherCallRow(entry: readonly [string, number]): string {
  const [name, n] = entry
  return `<div class="ac-row"><span class="ac-row-n">×${n}</span><code class="ac-cmd">${esc(name)}</code></div>`
}

function renderOtherCalls(r: ActivityReport): string {
  const others = Object.entries(r.toolCounts)
    .filter(([name]) => !KNOWN_TOOLS.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
  if (others.length === 0) return ''
  const total = others.reduce((sum, [, n]) => sum + n, 0)
  return collapseSub('Other calls', total, others.map(renderOtherCallRow).join(''))
}

function renderReportBody(r: ActivityReport): string {
  if (r.totalToolCalls === 0) return `<div class="ac-empty">No tool activity recorded.</div>`
  const sections =
    renderFileGroup('Files edited', 'edited', r.filesEdited) +
    renderFileGroup('Files written', 'written', r.filesWritten) +
    renderFileGroup('Files read', 'read', r.filesRead) +
    renderBashSection(r) +
    renderWorkflowSection(r) +
    renderFailedSection(r) +
    renderSearchSection('Grep patterns', r.grepSearches) +
    renderSearchSection('Glob patterns', r.globSearches) +
    renderTasksSection(r) +
    renderWebSection(r) +
    renderOtherCalls(r)
  return `${renderToolChips(r)}<div class="ac-body">${sections}</div>`
}

function renderPerStateRow(p: PerStateActivity, idx: number): string {
  const total = p.report.totalToolCalls
  const chip = `<span class="tr-state-chip ${stateCssClass(p.state)}">${esc(p.state)}</span>`
  const summary = `<span class="ac-state-summary">${esc(summarise(p.report))}</span>`
  const time = formatTimeOnly(p.startedAt)
  const empty = total === 0
  const rowCls = empty ? 'ac-state-row ac-state-empty' : 'ac-state-row'
  const headAttrs = empty ? '' : ` data-ac-toggle="${idx}"`
  const arrow = empty ? '·' : '▶'
  const body = empty ? '' : `<div class="ac-state-body">${renderReportBody(p.report)}</div>`
  return `<div class="${rowCls}" data-ac-state-idx="${idx}">` +
    `<div class="ac-state-head"${headAttrs}>` +
      `<span class="ac-state-arrow">${arrow}</span>` +
      chip +
      `<span class="ac-state-time">${esc(time)}</span>` +
      summary +
    `</div>` +
    body +
  `</div>`
}

function renderByState(resp: ActivityResponse): string {
  if (resp.byState.length === 0) return '<div class="ac-empty">No state-level activity available.</div>'
  return resp.byState.map((p, i) => renderPerStateRow(p, i)).join('')
}

/** @riviere-role web-tbc */
export function renderActivityPanel(resp: ActivityResponse): string {
  return `<div class="ac-wrap">` +
    `<section class="ac-section">` +
      `<div class="ac-section-head">Overall activity <span class="ac-section-sub">(whole session)</span></div>` +
      renderReportBody(resp.overall) +
    `</section>` +
    `<section class="ac-section">` +
      `<div class="ac-section-head">Activity by state <span class="ac-section-sub">(${resp.byState.length} transitions)</span></div>` +
      renderByState(resp) +
    `</section>` +
  `</div>`
}

function toggleCollapse(body: Element | null, arrow: HTMLElement | null): void {
  if (!(body instanceof HTMLElement) || arrow === null) return
  const open = body.classList.toggle('open')
  arrow.textContent = open ? '▼' : '▶'
}

function attachStateToggles(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('[data-ac-toggle]').forEach((head) => {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling
      if (!(body instanceof HTMLElement) || !body.classList.contains('ac-state-body')) return
      toggleCollapse(body, head.querySelector<HTMLElement>('.ac-state-arrow'))
    })
  })
}

function attachSubToggles(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('[data-ac-sub-toggle]').forEach((head) => {
    head.addEventListener('click', (ev) => {
      ev.stopPropagation()
      toggleCollapse(head.nextElementSibling, head.querySelector<HTMLElement>('.ac-sub-arrow'))
    })
  })
}

/** @riviere-role web-tbc */
export function attachActivityListeners(container: HTMLElement): void {
  attachStateToggles(container)
  attachSubToggles(container)
}
