import type { PreconditionResult } from '@nt-ai-lab/deterministic-agent-workflow-dsl'
import type { ArgParser } from './argument-parser-types'

type RouteHandler<TWorkflow> = (workflow: TWorkflow, ...parsedArgs: readonly unknown[]) => PreconditionResult

type TransactionRoute<TWorkflow> = {
  readonly type: 'transaction'
  readonly args?: readonly ArgParser<unknown>[]
  readonly handler: RouteHandler<TWorkflow>
}

type TransitionRoute = {
  readonly type: 'transition'
  readonly args?: readonly ArgParser<unknown>[]
}

type SessionStartRoute = {
  readonly type: 'session-start'
  readonly args?: readonly ArgParser<unknown>[]
}

type RouteStateMarker<TState> = {readonly __stateBrand?: TState}

/** @riviere-role value-object */
export type RouteDefinition<TWorkflow, TState> = (
  | TransactionRoute<TWorkflow>
  | TransitionRoute
  | SessionStartRoute
) & RouteStateMarker<TState>

/** @riviere-role value-object */
export type RouteMap<TWorkflow, TState> = Record<string, RouteDefinition<TWorkflow, TState>>

/** @riviere-role domain-service */
export function defineRoutes<TWorkflow, TState>(
  routes: RouteMap<TWorkflow, TState>,
): RouteMap<TWorkflow, TState> {
  return routes
}
