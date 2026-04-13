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
void renderRoute(initialRoute)
onRouteChange((route) => {
  void renderRoute(route)
})
initSse()
