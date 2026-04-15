import type {
  ActivityResponse,
  ActivityReport,
  PerStateActivity,
} from '../api-client'
import { esc } from '../render'

function toolSummary(report: ActivityReport): string {
  const parts: Array<string> = []
  if (report.totalToolCalls > 0) {
    parts.push(`${report.totalToolCalls} tool calls`)
  }
  if (report.filesTouchedTotal > 0) {
    parts.push(`${report.filesTouchedTotal} files touched`)
  }
  if (report.bashTotal > 0) {
    parts.push(`${report.bashTotal} bash commands`)
  }
  return parts.length === 0 ? 'No activity recorded.' : parts.join(' · ')
}

function renderSimpleList(label: string, rows: ReadonlyArray<{
  readonly value: string;
  readonly count: number 
}>): string {
  if (rows.length === 0) {
    return ''
  }
  const body = rows
    .slice(0, 10)
    .map((row) => `<li><span class="ac-count">×${row.count}</span><code>${esc(row.value)}</code></li>`)
    .join('')
  return `<section class="ac-sub"><h5>${esc(label)}</h5><ul>${body}</ul></section>`
}

function reportToRows(report: ActivityReport): {
  readonly tools: ReadonlyArray<{
    readonly value: string;
    readonly count: number 
  }
  >
  readonly bash: ReadonlyArray<{
    readonly value: string;
    readonly count: number 
  }
  >
  readonly files: ReadonlyArray<{
    readonly value: string;
    readonly count: number 
  }
  >
} {
  const tools = Object.entries(report.toolCounts).map(([value, count]) => ({
    value,
    count,
  }))
  const bash = report.bashCommands.map((item) => ({
    value: item.command,
    count: item.count,
  }))
  const files = report.filesEdited.map((item) => ({
    value: item.path,
    count: item.count,
  }))
  return {
    tools,
    bash,
    files,
  }
}

function renderReport(report: ActivityReport): string {
  const rows = reportToRows(report)
  return `<div class="ac-report">` +
    `<div class="ac-summary">${esc(toolSummary(report))}</div>` +
    renderSimpleList('Top tools', rows.tools) +
    renderSimpleList('Top bash', rows.bash) +
    renderSimpleList('Edited files', rows.files) +
    `</div>`
}

function renderPerState(state: PerStateActivity, index: number): string {
  const toggleId = `ac-state-${index}`
  const periodEnd = state.endedAt === null ? '' : ` → ${state.endedAt}`
  const period = `${state.startedAt}${periodEnd}`
  return `<details class="ac-state" id="${toggleId}">` +
    `<summary><strong>${esc(state.state)}</strong><span class="ac-period">${esc(period)}</span></summary>` +
    renderReport(state.report) +
    `</details>`
}

/** @riviere-role web-tbc */
export function renderActivityPanel(resp: ActivityResponse): string {
  const byState = resp.byState.length === 0
    ? '<div class="ac-empty">No state-level activity available.</div>'
    : resp.byState.map((state, index) => renderPerState(state, index)).join('')

  return `<div class="ac-wrap">` +
    `<section class="ac-section"><h4>Overall activity</h4>${renderReport(resp.overall)}</section>` +
    `<section class="ac-section"><h4>Activity by state</h4>${byState}</section>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function attachActivityListeners(container: HTMLElement): void {
  const details = container.querySelectorAll<HTMLDetailsElement>('details.ac-state')
  for (const item of details) {
    item.addEventListener('toggle', () => {
      if (item.open) {
        item.classList.add('open')
        return
      }
      item.classList.remove('open')
    })
  }
}
