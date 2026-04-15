import type {
  SessionDetailDto, EventDto, SuggestionDto
} from '../api-client'
import { api } from '../api-client'
import { renderMetricCards } from '../components/metric-cards'
import {
  renderTimelineBar, attachTimelineListeners, computeTimelineSegments 
} from '../components/timeline-bar'
import {
  renderEventStream, attachEventStreamListeners 
} from '../components/event-stream'
import { renderJournalList } from '../components/journal-list'
import {
  renderInsights, attachInsightListeners 
} from '../components/insight-cards'
import {
  renderSuggestions, attachSuggestionListeners 
} from '../components/suggestion-cards'
import {
  renderContinueTab, attachContinueListeners
} from '../components/continue-tab'
import {
  renderTranscript, attachTranscriptListeners
} from '../components/transcript-view'
import {
  html, esc, formatDuration, formatTimestamp, formatTimeOnly, truncateId
} from '../render'
import {
  asHtmlElement,
  getDatasetValue,
  storeWindowValue,
} from '.././dom'

type TabName = 'overview' | 'events' | 'journal' | 'insights' | 'continue' | 'transcript'

/** @riviere-role web-tbc */
export async function renderSessionDetail(container: HTMLElement, sessionId: string): Promise<void> {
  container.innerHTML = html`<div class="loading">Loading session ${truncateId(sessionId)}...</div>`

  try {
    const session = await api.getSession(sessionId)
    let sessionTimer: ReturnType<typeof setInterval> | undefined
    const state: {
      activeTab: TabName
      eventsCache: Array<EventDto> | null
      eventsTotal: number
      transcriptRendered: string | null
      drillFilter: {
        dimension: string
        value: string
      } | null
    } = {
      activeTab: 'overview',
      eventsCache: null,
      eventsTotal: 0,
      transcriptRendered: null,
      drillFilter: null,
    }

    // Cross-tab deep-link: transcript "events →" link switches to events tab.
    // Remove any previous listener (from an earlier session view) to avoid stacking.
    const w = window as unknown as Record<string, unknown>
    const prev = w['__trGotoEventsHandler']
    if (typeof prev === 'function') {
      window.removeEventListener('tr:goto-events', prev as EventListener)
    }
    const handler: EventListener = () => {
      state.activeTab = 'events'
      state.eventsCache = null
      void renderContent()
    }
    window.addEventListener('tr:goto-events', handler)
    w['__trGotoEventsHandler'] = handler

    async function renderContent(): Promise<void> {
      container.innerHTML = renderSessionPage(session, state.activeTab, state.eventsCache, state.eventsTotal, state.transcriptRendered)
      attachTabListeners(container, (tab: TabName) => {
        state.activeTab = tab
        state.drillFilter = null
        void renderContent()
      })
      attachInsightListeners(container)
      attachSuggestionListeners(container)
      attachTimelineListeners()
      attachContinueListeners(container)
      attachDrillDownListeners(container, async (dim, val) => {
        state.activeTab = 'events'
        state.drillFilter = {
          dimension: dim,
          value: val
        }
        state.eventsCache = null
        clearInterval(sessionTimer)
        await renderContent()
      })

      if (state.activeTab === 'events') {
        if (!state.eventsCache) {
          const filterParams = state.drillFilter?.dimension === 'outcome' && state.drillFilter.value === 'denied'
            ? {
              limit: 500,
              denied: true
            }
            : { limit: 500 }
          const {
            events, total
          } = await api.getSessionEvents(sessionId, filterParams)
          state.eventsCache = events
          state.eventsTotal = total
          storeWindowValue('__events', events)
        }
        const eventsEl = container.querySelector('#events-tab-content')
        if (eventsEl) {
          eventsEl.innerHTML = renderEventStream(state.eventsCache, state.eventsTotal)
          attachEventStreamListeners()
        } else if (state.eventsCache) {
          attachEventStreamListeners()
        }
      }

      if (state.activeTab === 'transcript' && state.transcriptRendered === null) {
        const transcriptEl = container.querySelector('#transcript-tab-content')
        try {
          const data = await api.getTranscript(sessionId)
          const rendered = renderTranscript(data, { session })
          state.transcriptRendered = rendered
          if (transcriptEl) {
            transcriptEl.classList.remove('loading')
            transcriptEl.innerHTML = rendered
            attachTranscriptListeners()
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          if (transcriptEl) transcriptEl.innerHTML = `<div style="padding:24px;color:#e74c3c">Failed to load transcript: ${esc(msg)}</div>`
        }
        return
      }

      if (state.activeTab === 'transcript' && state.transcriptRendered !== null) {
        attachTranscriptListeners()
      }

      clearInterval(sessionTimer)
      ;(window as unknown as Record<string, unknown>)['__sessionTimer'] = undefined
      if (state.activeTab === 'overview') {
        sessionTimer = setInterval(async () => {
          try {
            const fresh = await api.getSession(sessionId)
            const overviewEl = container.querySelector('#overview-tab-content')
            if (overviewEl instanceof HTMLElement) {
              overviewEl.innerHTML = renderOverviewTab(fresh)
              attachDrillDownListeners(container, async (dim, val) => {
                state.activeTab = 'events'
                state.drillFilter = { dimension: dim, value: val }
                state.eventsCache = null
                clearInterval(sessionTimer)
                await renderContent()
              })
            }
          } catch {
            // silent
          }
        }, 120_000)
        ;(window as unknown as Record<string, unknown>)['__sessionTimer'] = sessionTimer
      } else {
        // Don't update UI, but silently pre-fetch so tab switches feel instant
        sessionTimer = setInterval(async () => {
          try { await api.getSession(sessionId) } catch { /* silent */ }
        }, 120_000)
        ;(window as unknown as Record<string, unknown>)['__sessionTimer'] = sessionTimer
      }
    }

    await renderContent()
  } catch {
    container.innerHTML = html`<div class="loading">Session not found</div>`
  }
}

function buildGithubLink(repo: string | undefined, path: string, num: number): string {
  if (repo === undefined) return `#${num}`
  return `<a href="https://github.com/${esc(repo)}/${path}/${num}" target="_blank">#${num}</a>`
}

function missing(): string {
  return '<span style="color:#c0392b;font-weight:500">MISSING</span>'
}

function renderSessionPage(session: SessionDetailDto, activeTab: TabName, events: Array<EventDto> | null, eventsTotal: number, transcriptRendered: string | null): string {
  const headerParts: Array<string> = []

  const repoDisplay = session.repository ? esc(session.repository) : missing()
  headerParts.push(`<h1>${repoDisplay}</h1>`)
  headerParts.push(html`<span class="sep">│</span>`)
  headerParts.push(html`<span><span class="ml">Session</span> ${truncateId(session.sessionId)}</span>`)

  const isComplete = session.currentState === 'COMPLETE'
  const statusClass = isComplete ? 'status-complete' : 'status-active'
  const statusText = isComplete ? '✅ COMPLETE' : esc(session.currentState)
  headerParts.push(html`<span class="status ${statusClass}">${statusText}</span>`)
  headerParts.push(html`<span class="sep">│</span>`)

  headerParts.push(html`<span><span class="ml">Started</span> ${esc(formatTimestamp(session.firstEventAt))}</span>`)
  headerParts.push(html`<span>→</span>`)
  const endLabel = session.status === 'active' ? 'In Progress' : 'Ended'
  const endTime = session.status === 'active' ? '' : esc(formatTimeOnly(session.lastEventAt))
  headerParts.push(html`<span><span class="ml">${endLabel}</span> ${endTime}</span>`)
  headerParts.push(html`<span>(${formatDuration(session.durationMs)})</span>`)

  headerParts.push(html`<span class="sep">│</span>`)
  const issueDisplay = session.issueNumber === undefined
    ? missing()
    : `${buildGithubLink(session.repository, 'issues', session.issueNumber)}`
  headerParts.push(`<span><span class="ml">Issue</span> ${issueDisplay}</span>`)

  const branchDisplay = session.featureBranch ? esc(session.featureBranch) : missing()
  headerParts.push(`<span><span class="ml">Branch</span> ${branchDisplay}</span>`)

  const prDisplay = session.prNumber === undefined
    ? missing()
    : `${buildGithubLink(session.repository, 'pull', session.prNumber)}`
  headerParts.push(`<span><span class="ml">PR</span> ${prDisplay}</span>`)

  const hasInsightPrompts = session.insights.some((insight) => typeof insight.prompt === 'string' && insight.prompt.length > 0)
  const hasSuggestionPrompts = session.suggestions.some((suggestion) => typeof suggestion.prompt === 'string' && suggestion.prompt.length > 0)
  const hasPrompts = hasInsightPrompts || hasSuggestionPrompts

  const tabNames: Array<{
    name: TabName;
    label: string;
    count?: number 
  }> = [
    {
      name: 'overview',
      label: 'Overview' 
    },
    {
      name: 'events',
      label: 'Event Log',
      count: session.totalEvents
    },
    {
      name: 'transcript' as const,
      label: 'Transcript'
    },
    {
      name: 'journal',
      label: 'Journal',
      count: session.journalEntries.length 
    },
    {
      name: 'insights',
      label: 'Insights',
      count: session.insights.length 
    },
  ]
  if (hasPrompts) {
    tabNames.push({
      name: 'continue',
      label: 'Continue in Claude Code' 
    })
  }

  const tabBar = tabNames.map((t) => {
    const activeClass = t.name === activeTab ? ' active' : ''
    const countHtml = t.count === undefined ? '' : html` <span class="tc">${t.count}</span>`
    return html`<button class="tab${activeClass}" data-tab="${t.name}">${t.label}${countHtml}</button>`
  }).join('')

  const tabContentByName: Record<TabName, string> = {
    overview: `<div id="overview-tab-content">${renderOverviewTab(session)}</div>`,
    events: events
      ? renderEventStream(events, eventsTotal)
      : html`<div id="events-tab-content" class="loading">Loading events...</div>`,
    transcript: transcriptRendered !== null
      ? `<div id="transcript-tab-content">${transcriptRendered}</div>`
      : html`<div id="transcript-tab-content" class="loading">Loading transcript...</div>`,
    journal: renderJournalList(session.journalEntries),
    insights: renderInsights(session.insights),
    continue: renderContinueTab(session.insights, session.suggestions),
  }
  const tabContent = tabContentByName[activeTab]

  return html`<div class="header" style="margin:-20px -24px 0;padding:10px 24px"><div class="header-row"><a href="#/" class="page-back">← Sessions</a><span class="sep">│</span>${headerParts.join('\n')}</div></div>` +
    html`<div class="tab-bar" style="margin:0 -24px;padding:0 24px">${tabBar}</div>` +
    html`<div style="padding:20px 0">${tabContent}</div>`
}

function renderOverviewTab(session: SessionDetailDto): string {
  const totalDenials = session.permissionDenials.write + session.permissionDenials.bash +
    session.permissionDenials.pluginRead + session.permissionDenials.idle

  const suggestions: Array<SuggestionDto> = session.suggestions

  const hasInsightsOrSuggestions = session.insights.length > 0 || suggestions.length > 0

  const insightsHtml = session.insights.length === 0
    ? ''
    : html`<div class="slabel">Insights</div>` + renderInsights(session.insights)
  const suggestionsHtml = suggestions.length === 0
    ? ''
    : html`<div class="slabel" style="margin-top:16px">Suggestions</div>` + renderSuggestions(suggestions)
  const analysisHtml = hasInsightsOrSuggestions
    ? insightsHtml + suggestionsHtml + html`<div class="slabel" style="margin-top:16px">Session Shape</div>`
    : ''

  const segments = computeTimelineSegments(session.statePeriods)

  return analysisHtml +
    renderMetricCards([
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
        warn: totalDenials > 0,
        ...(totalDenials > 0 ? {
          drillDown: {
            dimension: 'outcome',
            value: 'denied' 
          } 
        } : {}) 
      },
      {
        label: 'Agents',
        value: session.activeAgents.length,
        ...(session.activeAgents.length > 0 ? { tooltip: session.activeAgents.join(', ') } : {}) 
      },
    ]) +
    renderTimelineBar(segments, session.workflowStates)
}

function attachTabListeners(
  container: HTMLElement,
  onTabChange: (tab: TabName) => void,
): void {
  container.querySelectorAll('.tab').forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
      if (!asHtmlElement(tabEl)) return
      const tabName = getDatasetValue(tabEl, 'tab')
      if (tabName === 'overview' || tabName === 'events' || tabName === 'journal' || tabName === 'insights' || tabName === 'continue' || tabName === 'transcript') {
        onTabChange(tabName)
      }
    })
  })
}

function attachDrillDownListeners(
  container: HTMLElement,
  onDrill: (dimension: string, value: string) => Promise<void>,
): void {
  container.querySelectorAll('.metric-link').forEach((el) => {
    el.addEventListener('click', () => {
      if (!asHtmlElement(el)) return
      const dim = getDatasetValue(el, 'drillDim')
      const val = getDatasetValue(el, 'drillVal')
      if (dim && val) {
        void onDrill(dim, val)
      }
    })
  })
}
