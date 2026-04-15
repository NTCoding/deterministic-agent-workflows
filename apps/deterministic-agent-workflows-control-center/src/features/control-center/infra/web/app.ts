import {
  parseRoute, onRouteChange
} from './router'
import type { Route } from './router'
import { renderDashboard } from './views/dashboard'
import { renderSessionDetail } from './views/session-detail'
import { renderAnalytics } from './views/analytics'
import { renderSessionCompare } from './views/session-compare'
import { createSseClient } from './sse-client'
import {
  MissingElementError, asHtmlElement, getDatasetValue
} from './dom'

console.log('App module loaded')

// Global error handler for module execution
window.addEventListener('error', (event) => {
  const app = document.getElementById('app')
  if (app?.innerHTML.length === 0) {
    const appEl = document.getElementById('app')
    if (appEl) {
      appEl.innerHTML = `<div style="color: red; padding: 20px; white-space: pre-wrap; font-family: monospace; font-size: 12px;">ERROR: ${event.message}\n${event.filename}:${event.lineno}</div>`
    }
  }
  console.error('Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  const app = document.getElementById('app')
  if (app) {
    app.innerHTML = `<div style="color: red; padding: 20px; white-space: pre-wrap; font-family: monospace; font-size: 12px;">UNHANDLED REJECTION: ${event.reason}</div>`
  }
  console.error('Unhandled rejection:', event.reason)
})

function getAppContainer(): HTMLElement {
  const el = document.getElementById('app')
  if (!el) throw new MissingElementError('Missing #app element')
  return el
}

async function renderRoute(route: Route): Promise<void> {
  const container = getAppContainer()

  document.querySelectorAll('.nav-link').forEach((link) => {
    if (!asHtmlElement(link)) return
    const linkRoute = getDatasetValue(link, 'route')
    if (linkRoute === undefined) return
    link.classList.toggle('active', route.view === 'dashboard' ? linkRoute === '/' : linkRoute === `/${route.view}`)
  })

  switch (route.view) {
    case 'dashboard':
      await renderDashboard(container)
      break
    case 'session':
      await renderSessionDetail(container, route.id)
      break
    case 'analytics':
      await renderAnalytics(container)
      break
    case 'compare':
      await renderSessionCompare(container, route.a, route.b)
      break
  }
}

function initSse(): void {
  createSseClient({
    onNewEvent() {
      const route = parseRoute()
      if (route.view === 'dashboard') {
        void renderRoute(route)
      }
    },
    onStateChange() {
      const route = parseRoute()
      if (route.view === 'dashboard' || route.view === 'session') {
        void renderRoute(route)
      }
    },
    onSessionStarted() {
      const route = parseRoute()
      if (route.view === 'dashboard') {
        void renderRoute(route)
      }
    },
  })
}

const initialRoute = parseRoute()
renderRoute(initialRoute).catch((err) => {
  const container = document.getElementById('app')
  if (container) {
    container.innerHTML = `<div style="color:red;padding:20px;">Error: ${err instanceof Error ? err.message : String(err)}</div>`
  }
  console.error('Failed to render initial route:', err)
})
onRouteChange((route) => {
  renderRoute(route).catch((err) => {
    console.error('Failed to render route:', err)
  })
})
initSse()
