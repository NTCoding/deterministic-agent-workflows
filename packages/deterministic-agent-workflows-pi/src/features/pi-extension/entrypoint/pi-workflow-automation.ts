import type {
  ExtensionAPI, ExtensionContext
} from '@earendil-works/pi-coding-agent'
import { ReviewCoordinator } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { WorkflowStateError } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type { PiWorkflowIdleContext } from '../../../platform/domain/pi-workflow-extension-types'
import { createPiExtensionContextWindow } from '../../../platform/infra/external-clients/pi/pi-extension-context-window'

/** @riviere-role cli-entrypoint */
export function registerPiWorkflowAutomation<TState extends { readonly currentStateMachineState: string }>(
  pi: ExtensionAPI,
  options: {
    readonly databasePath: string
    readonly automation?: {
      readonly ownsState: (state: TState) => boolean
      readonly onIdle: (context: PiWorkflowIdleContext<TState>) => Promise<void>
    }
    readonly isReady: (ctx: ExtensionContext) => boolean
    readonly getState: (ctx: ExtensionContext) => TState
    readonly runOperation: (ctx: ExtensionContext, args: readonly string[]) => {
      readonly exitCode: number;
      readonly output: string
    }
    readonly fail: (ctx: ExtensionContext, reason: string) => void
  },
) {
  const automation = options.automation
  if (automation === undefined) return {
    ownsState: () => false,
    afterOperation: () => undefined,
  }
  const active = new Map<string, AbortController>()
  const cancellations = new Map<string, Set<() => Promise<void>>>()
  const refreshContext = createPiExtensionContextWindow(pi)
  const fail = (ctx: ExtensionContext, error: unknown) => {
    options.fail(ctx, `Workflow automation failed: ${String(error)}`)
  }
  const isReady = (ctx: ExtensionContext): boolean => {
    try {
      return options.isReady(ctx)
    } catch (error) {
      fail(ctx, error)
      return false
    }
  }
  const ownsState = (ctx: ExtensionContext): boolean => {
    if (!isReady(ctx)) return false
    try {
      return active.has(ctx.sessionManager.getSessionId()) || automation.ownsState(options.getState(ctx))
    } catch (error) {
      fail(ctx, error)
      return true
    }
  }
  const runIdle = async (ctx: ExtensionContext): Promise<void> => {
    const sessionId = ctx.sessionManager.getSessionId()
    if (!isReady(ctx) || !ctx.isIdle() || active.has(sessionId) || !ownsState(ctx)) return
    const controller = new AbortController()
    active.set(sessionId, controller)
    const stops = new Set<() => Promise<void>>()
    cancellations.set(sessionId, stops)
    const requireActive = () => {
      if (controller.signal.aborted || active.get(sessionId) !== controller ||
        ctx.sessionManager.getSessionId() !== sessionId || !isReady(ctx)) {
        throw new WorkflowStateError('The workflow automation context is no longer active.')
      }
    }
    const resume: { instructions?: string } = {}
    try {
      await automation.onIdle({
        sessionId,
        signal: controller.signal,
        workingDirectory: ctx.cwd,
        getState: () => {
          requireActive()
          return options.getState(ctx)
        },
        runOperation: (operation, ...args) => {
          requireActive()
          const result = options.runOperation(ctx, [operation, ...args])
          if (result.exitCode !== 0) throw new WorkflowStateError(result.output)
          return result.output
        },
        runReviews: async (request, client) => {
          requireActive()
          const store = createStore(options.databasePath)
          const coordinator = new ReviewCoordinator({
            store,
            client,
            now: () => new Date().toISOString()
          })
          const cancel = async () => {
            const result = await coordinator.cancel(request.bundleId, 'Pi session shutdown')
            if (result.type === 'failed') throw new WorkflowStateError(result.reason)
          }
          stops.add(cancel)
          try {
            return await coordinator.run({
              ...request,
              sessionId,
              workingDirectory: ctx.cwd
            }, options.getState(ctx).currentStateMachineState)
          } finally {
            stops.delete(cancel)
            store.db.close()
          }
        },
        resumeWithFreshContext: (instructions) => {
          requireActive()
          if (resume.instructions !== undefined) throw new WorkflowStateError('Workflow automation already requested a fresh context.')
          if (automation.ownsState(options.getState(ctx))) {
            throw new WorkflowStateError('Cannot resume the conversational agent in a workflow-owned state.')
          }
          refreshContext(ctx, instructions)
          resume.instructions = instructions
        },
      })
    } catch (error) {
      fail(ctx, error)
      return
    } finally {
      active.delete(sessionId)
      cancellations.delete(sessionId)
    }
    if (!controller.signal.aborted && resume.instructions !== undefined) {
      pi.sendUserMessage(resume.instructions)
    }
  }
  pi.on('session_shutdown', async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    active.get(sessionId)?.abort()
    const results = await Promise.allSettled([...cancellations.get(sessionId) ?? []].map((cancel) => cancel()))
    for (const result of results) {
      if (result.status === 'rejected') fail(ctx, result.reason)
    }
  })
  pi.on('agent_settled', (_event, ctx) => runIdle(ctx))
  pi.on('session_start', (_event, ctx) => runIdle(ctx))
  pi.on('tool_call', (_event, ctx) => {
    if (ownsState(ctx)) return {
      block: true,
      reason: 'The workflow owns this state; conversational tools are disabled.'
    }
    return undefined
  })
  pi.on('input', (_event, ctx) => {
    if (ownsState(ctx)) return { action: 'handled' }
    return undefined
  })
  pi.on('session_before_switch', (_event, ctx) => {
    if (active.has(ctx.sessionManager.getSessionId())) return { cancel: true }
    return undefined
  })
  return {
    ownsState,
    afterOperation: (ctx: ExtensionContext) => {
      if (!ownsState(ctx)) return
      if (ctx.isIdle()) void runIdle(ctx)
      else ctx.abort()
    },
  }
}
