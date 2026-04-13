import { api } from '../api-client'
import { renderMetricCards } from '../components/metric-cards'
import {
  renderLineChart, renderBarChart, renderStackedBar 
} from '../components/chart'
import {
  html, formatDuration, stateColor 
} from '../render'
import {
  asHtmlElement, getDatasetValue, getRequiredElement 
} from '.././dom'

/** @riviere-role web-tbc */
export async function renderAnalytics(container: HTMLElement): Promise<void> {
  container.innerHTML =
    html`<div class="slabel">Analytics</div>` +
    html`<div class="window-selector">` +
    html`<button class="window-btn" data-window="7d">7d</button>` +
    html`<button class="window-btn active" data-window="30d">30d</button>` +
    html`<button class="window-btn" data-window="90d">90d</button>` +
    html`</div>` +
    html`<div id="analytics-content" class="loading">Loading analytics...</div>`

  const state = { currentWindow: '30d' }
  void loadAnalytics(container, state.currentWindow)

  container.querySelectorAll('.window-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!asHtmlElement(btn)) return
      container.querySelectorAll('.window-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      state.currentWindow = getDatasetValue(btn, 'window') ?? '30d'
      void loadAnalytics(container, state.currentWindow)
    })
  })
}

async function loadAnalytics(container: HTMLElement, timeWindow: string): Promise<void> {
  const content = getRequiredElement(container, '#analytics-content', asHtmlElement)

  try {
    const [overview, durationTrend, denialTrend, patterns] = await Promise.all([
      api.getAnalyticsOverview(),
      api.getAnalyticsTrends({
        metric: 'duration',
        window: timeWindow,
        bucket: 'day' 
      }),
      api.getAnalyticsTrends({
        metric: 'denials',
        window: timeWindow,
        bucket: 'day' 
      }),
      api.getAnalyticsPatterns(),
    ])

    const durationPoints = durationTrend.dataPoints.map((p, i) => ({
      x: i,
      y: p.value 
    }))
    const denialPoints = denialTrend.dataPoints.map((p, i) => ({
      x: i,
      y: p.value 
    }))

    const hotspotBars = overview.denialHotspots.map((h) => ({
      label: h.target,
      value: h.count,
      color: '#d35400',
    }))

    const stateSegments = overview.stateTimeDistribution.map((s) => ({
      label: s.state,
      value: s.totalMs,
      color: stateColor(s.state),
    }))

    const patternRows = patterns.patterns.map((pattern) => {
      const links = pattern.exampleSessionIds
        .map((id) => html`<a href="#/session/${id}" class="session-id">${id.slice(0, 8)}</a> `)
        .join('')
      return html`<tr><td>${pattern.insightTitle}</td><td>${pattern.sessionCount}</td><td>${pattern.percentage}%</td><td>${links}</td></tr>`
    }).join('')

    const patternsHtml = patterns.patterns.length > 0
      ? html`<table class="data-table">` +
        html`<thead><tr><th>Pattern</th><th>Sessions</th><th>%</th><th>Examples</th></tr></thead>` +
        html`<tbody>${patternRows}</tbody></table>`
      : html`<div class="loading">No recurring patterns</div>`

    content.innerHTML =
      html`<div class="section">${renderMetricCards([
        {
          label: 'Total Sessions',
          value: overview.totalSessions 
        },
        {
          label: 'Avg Duration',
          value: formatDuration(overview.averageDurationMs) 
        },
        {
          label: 'Avg Denials',
          value: overview.averageDenialCount,
          warn: overview.averageDenialCount > 0 
        },
        {
          label: 'Total Events',
          value: overview.totalEvents 
        },
      ])}</div>` +
      html`<div class="section" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">` +
        html`<div class="chart-container"><div class="slabel">Duration Trend</div>${renderLineChart(durationPoints, {
          title: 'Duration (ms)',
          width: 400,
          height: 200 
        })}</div>` +
        html`<div class="chart-container"><div class="slabel">Denial Trend</div>${renderLineChart(denialPoints, {
          title: 'Denials',
          width: 400,
          height: 200 
        })}</div>` +
      html`</div>` +
      html`<div class="section"><div class="slabel">Recurring Patterns</div>${patternsHtml}</div>` +
      html`<div class="section" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">` +
        html`<div class="chart-container"><div class="slabel">Denial Hotspots</div>${renderBarChart(hotspotBars, 'horizontal')}</div>` +
        html`<div class="chart-container"><div class="slabel">State Time Distribution</div>${renderStackedBar(stateSegments)}</div>` +
      html`</div>`
  } catch {
    content.innerHTML = html`<div class="loading">Error loading analytics</div>`
  }
}
