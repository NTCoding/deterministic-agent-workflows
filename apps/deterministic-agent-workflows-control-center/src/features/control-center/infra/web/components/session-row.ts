import type { SessionSummaryDto } from '../api-client'
import {
  html, esc, formatDuration, formatLocalTimestamp, truncateId, stateCssClass, stateAbbrev
} from '../render'

function repoShortName(repository: string): string {
  const cleaned = repository
    .replace(/\.git$/, '')
    .replace(/^https?:\/\/github\.com\//, '')
  const parts = cleaned.split('/')
  return parts.length >= 2
    ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    : cleaned
}

function optionalText(value: string | undefined): string {
  if (value === undefined) return ''
  return value
}

/** @riviere-role web-tbc */
export function renderSessionRow(session: SessionSummaryDto): string {
  const duration = formatDuration(session.durationMs)
  const startedAt = session.startedAt === undefined
    ? '-'
    : formatLocalTimestamp(session.startedAt)
  const totalDenials = session.permissionDenials.write + session.permissionDenials.bash +
    session.permissionDenials.pluginRead + session.permissionDenials.idle
  const denialWarn = totalDenials > 0 ? ' warn' : ''

  const repoHtml = session.repository
    ? html`<span class="session-repo">${esc(repoShortName(session.repository))}</span>`
    : html`<span class="session-repo" style="color:#ccc;font-style:italic">unknown repo</span>`
  const branchHtml = session.featureBranch
    ? html`<span class="session-branch">${esc(session.featureBranch)}</span>`
    : ''
  const prHtml = session.prNumber === undefined
    ? ''
    : html`<span class="session-pr">PR #${session.prNumber}</span>`

  const repoData = optionalText(session.repository)
  const branchData = optionalText(session.featureBranch)

  return html`<div class="session-row" role="row" data-session-id="${session.sessionId}" data-repo="${esc(repoData)}" data-branch="${esc(branchData)}" onclick="window.location.hash='/session/${session.sessionId}'">` +
    html`<span class="session-identity" role="cell"><span class="session-id">${truncateId(session.sessionId)}</span>${repoHtml}${branchHtml}${prHtml}</span>` +
    html`<span class="session-state" role="cell"><span class="ev-badge ${stateCssClass(session.currentState)}">${esc(stateAbbrev(session.currentState))}</span></span>` +
    html`<span class="session-started" role="cell"><span class="session-meta-label">Started</span>${esc(startedAt)}</span>` +
    html`<span class="session-meta" role="cell">${duration}</span>` +
    html`<span class="session-meta" role="cell">${session.totalEvents} events</span>` +
    html`<span class="session-meta${denialWarn}" role="cell">${totalDenials} denials</span>` +
    html`<span class="session-meta" role="cell">${session.activeAgents.length} agents</span>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function renderSessionList(sessions: ReadonlyArray<SessionSummaryDto>): string {
  if (sessions.length === 0) {
    return html`<div class="loading">No sessions found</div>`
  }
  const header = html`<div class="session-list-header" role="row">` +
    html`<span role="columnheader">Session</span><span role="columnheader">State</span><span role="columnheader">Started</span><span role="columnheader">Duration</span>` +
    html`<span role="columnheader">Events</span><span role="columnheader">Denials</span><span role="columnheader">Agents</span></div>`
  return html`<div class="session-list" role="table">${header}${sessions.map(renderSessionRow).join('')}</div>`
}
