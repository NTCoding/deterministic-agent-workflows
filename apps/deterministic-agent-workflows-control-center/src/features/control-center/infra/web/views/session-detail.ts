import type {
  EventDto,
  SessionDetailDto,
} from '../api-client'
import { api } from '../api-client'
import {
  renderActivityPanel,
  attachActivityListeners,
} from '../components/activity-panel'
import {
  attachContinueListeners,
  renderContinueTab,
} from '../components/continue-tab'
import {
  attachEventStreamListeners,
  renderEventStream,
} from '../components/event-stream'
import {
  attachInsightListeners,
  renderInsights,
} from '../components/insight-cards'
import { renderJournalList } from '../components/journal-list'
import { renderMetricCards } from '../components/metric-cards'
import {
  attachSuggestionListeners,
  renderSuggestions,
} from '../components/suggestion-cards'
import {
  attachTimelineListeners,
  computeTimelineSegments,
  renderTimelineBar,
} from '../components/timeline-bar'
import {
  attachTranscriptListeners,
  renderTranscript,
} from '../components/transcript-view'
import {
  asHtmlElement,
  getDatasetValue,
  storeWindowValue,
} from '../dom'
import {
  esc,
  formatDuration,
  formatTimestamp,
  html,
  truncateId,
} from '../render'

type TabName = 'overview' | 'events' | 'journal' | 'insights' | 'continue' | 'transcript'

type RenderState = {
  activeTab: TabName
  events: Array<EventDto> | null
  eventsTotal: number
  transcript: string | null
}

function hasContinue(session: SessionDetailDto): boolean {
  return session.insights.some((insight) => typeof insight.prompt === 'string' && insight.prompt.length > 0) ||
    session.suggestions.some((suggestion) => typeof suggestion.prompt === 'string' && suggestion.prompt.length > 0)
}

function renderGithubNumber(repoRaw: string | undefined, kind: 'issues' | 'pull', n: number | undefined): string {
  if (n === undefined) return 'MISSING'
  if (repoRaw === undefined) return `#${n}`
  return `<a href="https://github.com/${esc(repoRaw)}/${kind}/${n}" target="_blank" rel="noopener">#${n}</a>`
}

function renderRepoLink(repoRaw: string | undefined): string {
  if (repoRaw === undefined) return '<span style="color:#c0392b">MISSING</span>'
  return `<a href="https://github.com/${esc(repoRaw)}" target="_blank" rel="noopener">${esc(repoRaw)}</a>`
}

function renderHeader(session: SessionDetailDto): string {
  const repoHtml = renderRepoLink(session.repository)
  const issueHtml = renderGithubNumber(session.repository, 'issues', session.issueNumber)
  const prHtml = renderGithubNumber(session.repository, 'pull', session.prNumber)
  return `<div class="header" style="margin:-20px -24px 0;padding:10px 24px">` +
    `<div class="header-row">` +
    `<a href="#/" class="page-back">← Sessions</a>` +
    `<span class="sep">│</span>` +
    `<h1>${repoHtml}</h1>` +
    `<span class="sep">│</span>` +
    `<span>Session ${truncateId(session.sessionId)}</span>` +
    `<span class="sep">│</span>` +
    `<span>${esc(session.currentState)}</span>` +
    `<span class="sep">│</span>` +
    `<span>Started ${esc(formatTimestamp(session.firstEventAt))}</span>` +
    `<span>(${formatDuration(session.durationMs)})</span>` +
    `<span class="sep">│</span>` +
    `<span>Issue ${issueHtml}</span>` +
    `<span>PR ${prHtml}</span>` +
    `</div></div>`
}

function renderTabBar(session: SessionDetailDto, activeTab: TabName): string {
  const tabs: Array<{
    readonly name: TabName;
    readonly label: string 
  }> = [
    {
      name: 'overview',
      label: 'Overview' 
    },
    {
      name: 'events',
      label: `Event Log (${session.totalEvents})` 
    },
    {
      name: 'transcript',
      label: 'Transcript' 
    },
    {
      name: 'journal',
      label: `Journal (${session.journalEntries.length})` 
    },
    {
      name: 'insights',
      label: `Insights (${session.insights.length})` 
    },
  ]
  if (hasContinue(session)) {
    tabs.push({
      name: 'continue',
      label: 'Continue in Claude Code',
    })
  }
  const buttons = tabs
    .map((tab) => `<button class="tab${tab.name === activeTab ? ' active' : ''}" data-tab="${tab.name}">${esc(tab.label)}</button>`)
    .join('')
  return `<div class="tab-bar" style="margin:0 -24px;padding:0 24px">${buttons}</div>`
}

function renderOverviewTab(session: SessionDetailDto): string {
  const totalDenials =
    session.permissionDenials.write +
    session.permissionDenials.bash +
    session.permissionDenials.pluginRead +
    session.permissionDenials.idle
  const segments = computeTimelineSegments(session.statePeriods)
  const metrics = renderMetricCards([
    {
      label: 'Duration',
      value: formatDuration(session.durationMs) 
    },
    {
      label: 'Events',
      value: session.totalEvents 
    },
    {
      label: 'Transitions',
      value: session.transitionCount 
    },
    {
      label: 'Hook Denials',
      value: totalDenials,
      warn: totalDenials > 0 
    },
    {
      label: 'Agents',
      value: session.activeAgents.length 
    },
  ])
  const insights = renderInsights(session.insights)
  const suggestions = renderSuggestions(session.suggestions)
  const activity = '<div id="activity-panel-host" class="ac-host"><div class="ac-loading">Loading activity…</div></div>'
  return insights + suggestions + metrics + renderTimelineBar(segments, session.workflowStates) + activity
}

function renderTabContent(session: SessionDetailDto, state: RenderState): string {
  if (state.activeTab === 'overview') {
    return renderOverviewTab(session)
  }
  if (state.activeTab === 'events') {
    return state.events === null
      ? '<div id="events-tab-content" class="loading">Loading events...</div>'
      : renderEventStream(state.events, state.eventsTotal)
  }
  if (state.activeTab === 'transcript') {
    return state.transcript === null
      ? '<div id="transcript-tab-content" class="loading">Loading transcript...</div>'
      : `<div id="transcript-tab-content">${state.transcript}</div>`
  }
  if (state.activeTab === 'journal') {
    return renderJournalList(session.journalEntries)
  }
  if (state.activeTab === 'insights') {
    return renderInsights(session.insights)
  }
  return renderContinueTab(session.insights, session.suggestions)
}

function parseTabName(value: string | undefined): TabName | null {
  if (value === 'overview' || value === 'events' || value === 'journal' || value === 'insights' || value === 'continue' || value === 'transcript') {
    return value
  }
  return null
}

function attachTabListeners(container: HTMLElement, onTabChange: (tab: TabName) => void): void {
  const tabs = container.querySelectorAll('.tab')
  for (const tabElement of tabs) {
    tabElement.addEventListener('click', () => {
      if (!asHtmlElement(tabElement)) {
        return
      }
      const tab = parseTabName(getDatasetValue(tabElement, 'tab'))
      if (tab !== null) {
        onTabChange(tab)
      }
    })
  }
}

async function loadEvents(sessionId: string, state: RenderState): Promise<void> {
  const result = await api.getSessionEvents(sessionId, { limit: 500 })
  state.events = result.events
  state.eventsTotal = result.total
  storeWindowValue('__events', result.events)
}

async function loadTranscript(sessionId: string, session: SessionDetailDto, state: RenderState): Promise<void> {
  const transcript = await api.getTranscript(sessionId)
  state.transcript = renderTranscript(transcript, { session })
}

function attachDetailListeners(container: HTMLElement): void {
  attachEventStreamListeners()
  attachInsightListeners(container)
  attachSuggestionListeners(container)
  attachTimelineListeners()
  attachContinueListeners(container)
  attachTranscriptListeners()
}

async function hydrateActivity(sessionId: string, container: HTMLElement): Promise<void> {
  const host = container.querySelector('#activity-panel-host')
  if (host instanceof HTMLElement) {
    const activity = await api.getSessionActivity(sessionId)
    host.innerHTML = renderActivityPanel(activity)
    attachActivityListeners(host)
  }
}

function renderPage(session: SessionDetailDto, state: RenderState): string {
  return renderHeader(session) +
    renderTabBar(session, state.activeTab) +
    html`<div style="padding:20px 0">${renderTabContent(session, state)}</div>`
}

/** @riviere-role web-tbc */
export async function renderSessionDetail(container: HTMLElement, sessionId: string): Promise<void> {
  container.innerHTML = html`<div class="loading">Loading session ${truncateId(sessionId)}...</div>`

  try {
    const session = await api.getSession(sessionId)
    const state: RenderState = {
      activeTab: 'overview',
      events: null,
      eventsTotal: 0,
      transcript: null,
    }

    const render = async (): Promise<void> => {
      if (state.activeTab === 'events' && state.events === null) {
        await loadEvents(sessionId, state)
      }
      if (state.activeTab === 'transcript' && state.transcript === null) {
        await loadTranscript(sessionId, session, state)
      }

      container.innerHTML = renderPage(session, state)
      attachDetailListeners(container)
      attachTabListeners(container, (tab) => {
        state.activeTab = tab
        void render()
      })

      if (state.activeTab === 'overview') {
        try {
          await hydrateActivity(sessionId, container)
        } catch {
          const host = container.querySelector('#activity-panel-host')
          if (host instanceof HTMLElement) {
            host.innerHTML = '<div class="ac-empty" style="color:#c0392b">Failed to load activity.</div>'
          }
        }
      }
    }

    await render()
  } catch {
    container.innerHTML = html`<div class="loading">Session not found</div>`
  }
}
