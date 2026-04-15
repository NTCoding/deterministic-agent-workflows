import { createServer } from 'node:http'
import type {
  Server, IncomingMessage, ServerResponse 
} from 'node:http'
import type { SessionQueryDeps } from '../../../domain/query/session-queries'
import {
  handleListSessions,
  handleGetSession,
  handleGetSessionEvents,
  handleGetSessionJournal,
  handleGetSessionInsights,
} from './handlers/session-handlers'
import type { SessionHandlerDeps } from './handlers/session-handlers'
import { handleGetTranscript } from './handlers/transcript-handler'
import type { TranscriptHandlerDeps } from './handlers/transcript-handler'
import {
  handleAnalyticsOverview,
  handleAnalyticsTrends,
  handleAnalyticsPatterns,
  handleAnalyticsCompare,
} from './handlers/analytics-handlers'
import type { AnalyticsHandlerDeps } from './handlers/analytics-handlers'
import {
  createRouter, sendError 
} from './router'
import type { Router } from './router'
import { createSseHub } from './sse-hub'
import type { SseHub } from './sse-hub'
import { createStaticFileServer } from './static-assets'
import type { StaticFileServer } from './static-assets'

/** @riviere-role web-tbc */
export type HttpServerDeps = {
  readonly queryDeps: SessionQueryDeps
  readonly distDir: string
  readonly now: () => Date
}

/** @riviere-role web-tbc */
export type HttpServerInstance = {
  readonly server: Server
  readonly router: Router
  readonly sseHub: SseHub
  readonly staticFiles: StaticFileServer
  readonly start: (port: number) => Promise<void>
  readonly stop: () => Promise<void>
}

/** @riviere-role web-tbc */
export function createHttpServer(deps: HttpServerDeps): HttpServerInstance {
  const router = createRouter()
  const sseHub = createSseHub()
  const staticFiles = createStaticFileServer(deps.distDir)

  const sessionDeps: SessionHandlerDeps = {
    queryDeps: deps.queryDeps,
    now: deps.now,
  }

  const analyticsDeps: AnalyticsHandlerDeps = {
    queryDeps: deps.queryDeps,
    now: deps.now,
  }

  const transcriptDeps: TranscriptHandlerDeps = {
    queryDeps: deps.queryDeps,
  }

  router.get('/api/sessions', handleListSessions(sessionDeps))
  router.get('/api/sessions/:id', handleGetSession(sessionDeps))
  router.get('/api/sessions/:id/events', handleGetSessionEvents(sessionDeps))
  router.get('/api/sessions/:id/journal', handleGetSessionJournal(sessionDeps))
  router.get('/api/sessions/:id/insights', handleGetSessionInsights(sessionDeps))
  router.get('/api/sessions/:id/transcript', handleGetTranscript(transcriptDeps))
  router.get('/api/analytics/overview', handleAnalyticsOverview(analyticsDeps))
  router.get('/api/analytics/trends', handleAnalyticsTrends(analyticsDeps))
  router.get('/api/analytics/patterns', handleAnalyticsPatterns(analyticsDeps))
  router.get('/api/analytics/compare', handleAnalyticsCompare(analyticsDeps))

  const connectionState = { counter: 0 }

  router.get('/events', (_req, res, route) => {
    const sessionFilter = route.query.get('session') ?? undefined
    connectionState.counter += 1
    const connId = `conn-${connectionState.counter}`
    sseHub.addConnection(connId, res, sessionFilter)
  })

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(router, staticFiles, req, res)
  })

  return {
    server,
    router,
    sseHub,
    staticFiles,

    start(port) {
      return new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(port, () => {
          sseHub.startHeartbeat()
          resolve()
        })
      })
    },

    stop() {
      return new Promise((resolve) => {
        sseHub.stopHeartbeat()
        server.close(() => resolve())
      })
    },
  }
}

async function handleRequest(
  router: Router,
  staticFiles: StaticFileServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const handled = await router.handle(req, res)
    if (handled) return

    const urlPath = req.url?.split('?')[0] ?? '/'
    if (staticFiles.serve(urlPath, res)) return

    sendError(res, 404, 'Not found')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    sendError(res, 500, message)
  }
}
