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
  MissingElementError,
  asHtmlElement,
  getDatasetValue,
} from './dom'

function renderFatalError(container: HTMLElement, title: string, detail: string): void {
  const div = document.createElement('div')
  div.style.cssText = 'color: red; padding: 20px; white-space: pre-wrap; font-family: monospace; font-size: 12px;'
  div.textContent = `${title}: ${detail}`
  container.innerHTML = ''
  container.append(div)
}

window.addEventListener('error', (event) => {
  const app = document.getElementById('app')
  if (app?.innerHTML.length === 0) {
    renderFatalError(app, 'ERROR', `${event.message}\n${event.filename}:${event.lineno}`)
  }
  console.error('Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  const app = document.getElementById('app')
  if (app) {
    renderFatalError(app, 'UNHANDLED REJECTION', String(event.reason))
  }
  console.error('Unhandled rejection:', event.reason)
})

function getAppContainer(): HTMLElement {
  const el = document.getElementById('app')
  if (!el) throw new MissingElementError('Missing #app element')
  return el
}

async function renderRoute(route: Route): Promise<void> {
  clearInterval(window.__dashboardTimer)
  clearInterval(window.__sessionTimer)
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

function showRouteError(err: unknown): void {
  const container = document.getElementById('app')
  if (container) {
    renderFatalError(container, 'Error', err instanceof Error ? err.message : String(err))
  }
  console.error('Failed to render route:', err)
}

const initialRoute = parseRoute()
renderRoute(initialRoute).catch(showRouteError)
onRouteChange((route) => {
  renderRoute(route).catch(showRouteError)
})
initSse()
