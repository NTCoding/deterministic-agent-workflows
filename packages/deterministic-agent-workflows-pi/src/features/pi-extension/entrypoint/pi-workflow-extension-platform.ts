import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ExtensionAPI, ExtensionContext 
} from '@earendil-works/pi-coding-agent'
import type { RunnerResult } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type { PiSessionIdResult } from '../../../platform/domain/pi-workflow-extension-types'

/** @riviere-role cli-entrypoint */
export function translationNote(toolName: string): string {
  return [
    `> **Pi**: When instructions say to run a workflow command, call the \`${toolName}\` tool instead:`,
    '> `operation: "<op>", args: ["<arg>", ...]`.',
    '',
    '---',
    '',
    '',
  ].join('\n')
}

/** @riviere-role cli-entrypoint */
export function resolveDatabasePath(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const fromEnvironment = process.env['WORKFLOW_EVENTS_DB']
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment
  return join(homedir(), 'ai-workflow-database', '.workflow-events.db')
}

/** @riviere-role cli-entrypoint */
export function readSessionId(ctx: ExtensionContext): PiSessionIdResult {
  try {
    const sessionId = ctx.sessionManager.getSessionId()
    if (sessionId.trim().length === 0) return {
      ok: false,
      reason: 'Pi returned an empty session UUID.' 
    }
    return {
      ok: true,
      sessionId 
    }
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `Pi session UUID is unavailable: ${String(error)}` 
    }
  }
}

/** @riviere-role cli-entrypoint */
export function requireSessionFile(ctx: ExtensionContext): string {
  const sessionFile = ctx.sessionManager.getSessionFile()
  if (sessionFile === undefined) throw new TypeError('Ephemeral Pi sessions are unsupported because no persistent transcript file is available.')
  return sessionFile
}

/** @riviere-role cli-entrypoint */
export function notifyRouteResult(ctx: ExtensionContext, pi: ExtensionAPI, result: RunnerResult): void {
  if (result.exitCode !== 0) {
    ctx.ui.notify(result.output, 'error')
    return
  }
  if (result.output === '') {
    ctx.ui.notify('Workflow operation completed.', 'info')
    return
  }
  pi.sendUserMessage(result.output)
}

/** @riviere-role cli-entrypoint */
export function readWorkflowInstruction(path: string, note: string): string {
  return `${note}${readFileSync(path, 'utf8')}`
}
