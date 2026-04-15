import type { SessionSummaryDto } from '../api-client'
import { api } from '../api-client'
import { renderMetricCards } from '../components/metric-cards'
import { renderSessionList } from '../components/session-row'
import {
  html, formatDuration 
} from '../render'

function matchesSearch(session: SessionSummaryDto, query: string): boolean {
  if (!query) return true
  const lower = query.toLowerCase()
  if (session.sessionId.toLowerCase().includes(lower)) return true
  if (session.repository?.toLowerCase().includes(lower)) return true
  if (session.featureBranch?.toLowerCase().includes(lower)) return true
  if (session.prNumber !== undefined && `#${session.prNumber}`.includes(lower)) return true
  if (session.prNumber !== undefined && `pr ${session.prNumber}`.includes(lower)) return true
  if (session.currentState.toLowerCase().includes(lower)) return true
  return false
}

type StatusFilter = 'all' | 'active' | 'completed'

function filterByStatus(sessions: ReadonlyArray<SessionSummaryDto>, filter: StatusFilter): ReadonlyArray<SessionSummaryDto> {
  if (filter === 'all') return sessions
  if (filter === 'active') return sessions.filter((s) => s.status === 'active')
  return sessions.filter((s) => s.status !== 'active')
}

function renderControls(activeFilter: StatusFilter): string {
  const filters: ReadonlyArray<{
    label: string;
    value: StatusFilter 
  }> = [
    {
      label: 'All',
      value: 'all' 
    },
    {
      label: 'Active',
      value: 'active' 
    },
    {
      label: 'Completed',
      value: 'completed' 
    },
  ]

  const filterButtons = filters.map((f) =>
    html`<button class="filter-btn${f.value === activeFilter ? ' active' : ''}" data-filter="${f.value}">${f.label}</button>`,
  ).join('')

  return html`<div class="session-controls">` +
    html`<input class="session-search" type="text" placeholder="Search by repo, branch, PR, or session ID..." />` +
    filterButtons +
    `</div>`
}

/** @riviere-role web-tbc */
export async function renderDashboard(container: HTMLElement): Promise<void> {
  clearInterval(window.__dashboardTimer)
  container.innerHTML = html`<div class="loading">Loading sessions...</div>`

  try {
    const data = await api.getSessions({ limit: 100 })
    const allSessions = data.sessions
    const state: {
      currentFilter: StatusFilter
      currentSearch: string
    } = {
      currentFilter: 'all',
      currentSearch: '',
    }

    function render(): void {
      const filtered = filterByStatus(allSessions, state.currentFilter)
      const searched = filtered.filter((s) => matchesSearch(s, state.currentSearch))

      const activeSessions = allSessions.filter((s) => s.status === 'active')
      const completedSessions = allSessions.filter((s) => s.status !== 'active')

      const avgDuration = computeAverageDuration(activeSessions, completedSessions)

      const totalDenials = allSessions.reduce((s, x) =>
        s + x.permissionDenials.write + x.permissionDenials.bash + x.permissionDenials.pluginRead + x.permissionDenials.idle, 0)

      const metricsHtml = renderMetricCards([
        {
          label: 'Active Sessions',
          value: activeSessions.length 
        },
        {
          label: 'Completed',
          value: completedSessions.length 
        },
        {
          label: 'Avg Duration',
          value: formatDuration(avgDuration) 
        },
        {
          label: 'Total Denials',
          value: totalDenials,
          warn: totalDenials > 0 
        },
      ])

      const listHtml = renderSessionList(searched)

      container.innerHTML =
        html`<div class="section">${metricsHtml}</div>` +
        html`<div class="section">${renderControls(state.currentFilter)}${listHtml}</div>`

      const searchInput = container.querySelector('.session-search')
      if (searchInput instanceof HTMLInputElement) {
        searchInput.value = state.currentSearch
        searchInput.addEventListener('input', () => {
          state.currentSearch = searchInput.value
          render()
        })
        searchInput.focus()
      }

      container.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const filterValue = btn.getAttribute('data-filter')
          if (filterValue === 'all' || filterValue === 'active' || filterValue === 'completed') {
            state.currentFilter = filterValue
            render()
          }
        })
      })
    }

    render()
    window.__dashboardTimer = setInterval(() => {
      void renderDashboard(container).catch(() => undefined)
    }, 120_000)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const div = document.createElement('div')
    div.className = 'loading'
    div.textContent = `Error loading sessions: ${message}`
    container.innerHTML = ''
    container.append(div)
    console.error('Failed to load sessions:', err)
  }
}

function computeAverageDuration(
  activeSessions: ReadonlyArray<SessionSummaryDto>,
  completedSessions: ReadonlyArray<SessionSummaryDto>,
): number {
  if (activeSessions.length > 0) {
    return activeSessions.reduce((sum, session) => sum + session.durationMs, 0) / activeSessions.length
  }
  if (completedSessions.length > 0) {
    return completedSessions.reduce((sum, session) => sum + session.durationMs, 0) / completedSessions.length
  }
  return 0
}
