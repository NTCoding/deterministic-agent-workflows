import type { SessionSummaryDto } from '../api-client'
import {
  html, esc, formatDuration, truncateId, stateCssClass, stateAbbrev 
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

  return html`<div class="session-row" data-session-id="${session.sessionId}" data-repo="${esc(repoData)}" data-branch="${esc(branchData)}" onclick="window.location.hash='/session/${session.sessionId}'">` +
    html`<span class="session-id">${truncateId(session.sessionId)}</span>` +
    repoHtml + branchHtml + prHtml +
    html`<span class="session-state"><span class="ev-badge ${stateCssClass(session.currentState)}">${esc(stateAbbrev(session.currentState))}</span></span>` +
    html`<span class="session-meta">${duration}</span>` +
    html`<span class="session-meta">${session.totalEvents} events</span>` +
    html`<span class="session-meta${denialWarn}">${totalDenials} denials</span>` +
    html`<span class="session-meta">${session.activeAgents.length} agents</span>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function renderSessionList(sessions: ReadonlyArray<SessionSummaryDto>): string {
  if (sessions.length === 0) {
    return html`<div class="loading">No sessions found</div>`
  }
  return html`<div class="session-list">${sessions.map(renderSessionRow).join('')}</div>`
}
