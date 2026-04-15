import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http'
import {
  existsSync,
  readFileSync,
} from 'node:fs'
import type {
  ActivityReport,
  ActivityResponse,
} from '../../api-types'
export type {
  ActivityReport,
  ActivityResponse,
} from '../../api-types'
import type { SessionQueryDeps } from '../../../../domain/query/session-queries'
import { getTranscriptPath } from '../../../../domain/query/session-queries'
import type { RouteParams } from '../router'
import {
  sendError,
  sendJson,
} from '../router'

/** @riviere-role web-tbc */
export type ActivityHandlerDeps = { readonly queryDeps: SessionQueryDeps }

function emptyReport(): ActivityReport {
  return {
    totalToolCalls: 0,
    toolCounts: {},
    bashCommands: [],
    bashTotal: 0,
    filesRead: [],
    filesEdited: [],
    filesWritten: [],
    filesTouchedTotal: 0,
    grepSearches: [],
    globSearches: [],
    tasksDelegated: [],
    webFetches: [],
    webSearches: [],
  }
}

function buildReportFromJsonl(path: string): ActivityReport {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const toolCounts: Record<string, number> = {}
  const tasksDelegated: Array<{
    readonly subagent: string;
    readonly description: string 
  }> = []
  for (const line of lines) {
    const matches = [...line.matchAll(/"name"\s*:\s*"([^"]+)"/g)]
    for (const match of matches) {
      const name = String(match[1])
      const count = toolCounts[name] ?? 0
      toolCounts[name] = count + 1
      if (name.toLowerCase() === 'task') {
        tasksDelegated.push({
          subagent: 'unknown',
          description: 'unknown',
        })
      }
    }
  }

  const totalToolCalls = Object.values(toolCounts).reduce((sum, value) => sum + value, 0)
  const bashTotal = toolCounts['bash'] ?? 0
  return {
    ...emptyReport(),
    totalToolCalls,
    toolCounts,
    bashTotal,
    tasksDelegated,
  }
}

function buildReport(path: string | null): ActivityReport {
  if (path === null || !existsSync(path)) {
    return emptyReport()
  }
  if (!path.endsWith('.jsonl')) {
    return emptyReport()
  }
  return buildReportFromJsonl(path)
}

/** @riviere-role web-tbc */
export function handleGetSessionActivity(
  deps: ActivityHandlerDeps,
): (_req: IncomingMessage, res: ServerResponse, route: RouteParams) => void {
  return (_req, res, route) => {
    const sessionId = route.params['id']
    if (sessionId === undefined) {
      sendError(res, 400, 'Missing session ID')
      return
    }

    const transcriptPath = getTranscriptPath(deps.queryDeps, sessionId)
    const response: ActivityResponse = {
      overall: buildReport(transcriptPath),
      byState: [],
    }
    sendJson(res, 200, response)
  }
}
