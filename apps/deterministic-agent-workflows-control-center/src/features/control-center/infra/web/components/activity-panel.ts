import type {
  ActivityReport,
  ActivityResponse,
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

function renderSimpleList(
  label: string,
  rows: ReadonlyArray<{
    readonly value: string;
    readonly count: number;
  }>,
): string {
  if (rows.length === 0) {
    return ''
  }

  const body = rows
    .slice(0, 10)
    .map((row) => `<div class="ac-row"><span class="ac-row-n">×${row.count}</span><code class="ac-cmd">${esc(row.value)}</code></div>`)
    .join('')

  return `<section class="ac-sub"><div class="ac-sub-head">${esc(label)}</div>${body}</section>`
}

function reportRows(report: ActivityReport): {
  readonly tools: ReadonlyArray<{
    readonly value: string;
    readonly count: number;
  }>;
  readonly bash: ReadonlyArray<{
    readonly value: string;
    readonly count: number;
  }>;
  readonly files: ReadonlyArray<{
    readonly value: string;
    readonly count: number;
  }>;
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

function renderToolChips(report: ActivityReport): string {
  const chips = Object.entries(report.toolCounts)
    .slice(0, 10)
    .map(([name, count]) => `<span class="ac-tool-chip">${esc(name)} <span class="ac-tool-n">×${count}</span></span>`)
    .join('')

  return chips.length === 0 ? '' : `<div class="ac-chips">${chips}</div>`
}

function renderReport(report: ActivityReport): string {
  const rows = reportRows(report)

  return `<div class="ac-report">` +
    `<div class="ac-loading">${esc(toolSummary(report))}</div>` +
    renderToolChips(report) +
    `<div class="ac-cols">` +
    `<div class="ac-col">` +
    renderSimpleList('Top tools', rows.tools) +
    renderSimpleList('Edited files', rows.files) +
    `</div>` +
    `<div class="ac-col">` +
    renderSimpleList('Top bash', rows.bash) +
    `</div>` +
    `</div>` +
    `</div>`
}

function renderPerState(state: PerStateActivity, index: number): string {
  const periodEnd = state.endedAt === null ? '' : ` → ${state.endedAt}`
  const period = `${state.startedAt}${periodEnd}`

  return `<div class="ac-state-row">` +
    `<div class="ac-state-head" data-ac-toggle="${index}">` +
    `<span class="ac-state-arrow">▶</span>` +
    `<strong>${esc(state.state)}</strong>` +
    `<span class="ac-state-time">${esc(period)}</span>` +
    `</div>` +
    `<div class="ac-state-body" id="ac-state-body-${index}">${renderReport(state.report)}</div>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function renderActivityPanel(resp: ActivityResponse): string {
  const byState = resp.byState.length === 0
    ? '<div class="ac-empty">No state-level activity available.</div>'
    : resp.byState.map((state, index) => renderPerState(state, index)).join('')

  return `<div class="ac-wrap">` +
    `<section class="ac-section"><div class="ac-section-head">Overall activity</div>${renderReport(resp.overall)}</section>` +
    `<section class="ac-section"><div class="ac-section-head">Activity by state</div>${byState}</section>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function attachActivityListeners(container: HTMLElement): void {
  const toggles = container.querySelectorAll<HTMLElement>('[data-ac-toggle]')
  for (const item of toggles) {
    item.addEventListener('click', () => {
      const index = item.getAttribute('data-ac-toggle')
      if (index === null) {
        return
      }

      const body = container.querySelector<HTMLElement>(`#ac-state-body-${index}`)
      const arrow = item.querySelector<HTMLElement>('.ac-state-arrow')
      if (body === null || arrow === null) {
        return
      }

      const open = body.classList.toggle('open')
      arrow.textContent = open ? '▼' : '▶'
    })
  }
}
