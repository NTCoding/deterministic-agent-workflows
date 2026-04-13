import type { BaseEvent } from './base-event'
import type { WorkflowEngineDeps } from './workflow-engine-types'
import type { WorkflowRegistry } from './workflow-registry'

/** @riviere-role domain-service */
export function buildPrefixPattern<TStateName extends string, TState>(
  registry: WorkflowRegistry<TState, TStateName, string>,
): RegExp {
  const prefixes: string[] = []
  for (const stateName in registry) {
    const definition = registry[stateName]
    prefixes.push(`${definition.emoji} ${stateName}`)
  }
  return new RegExp(`^(${prefixes.join('|')})`)
}

/** @riviere-role domain-service */
export function getExpectedPrefix<TStateName extends string, TState, TOperation extends string>(
  stateName: TStateName,
  registry: WorkflowRegistry<TState, TStateName, TOperation>,
): string {
  return `${registry[stateName].emoji} ${stateName}`
}

/** @riviere-role domain-service */
export function buildProcedurePath<TStateName extends string>(
  engineDeps: WorkflowEngineDeps,
  stateName: TStateName,
): string {
  return `${engineDeps.getPluginRoot()}/states/${String(stateName).toLowerCase()}.md`
}

/** @riviere-role domain-service */
export function readProcedure<TStateName extends string>(engineDeps: WorkflowEngineDeps, stateName: TStateName): string {
  return engineDeps.readFile(buildProcedurePath(engineDeps, stateName))
}

/** @riviere-role domain-service */
export function enrichSessionStartedEvents<TStateName extends string>(
  engineDeps: WorkflowEngineDeps,
  events: readonly BaseEvent[],
  transcriptPath: string,
  repository: string | undefined,
  currentState: TStateName,
  states: readonly string[],
): readonly BaseEvent[] {
  const enriched = events.map((event) => {
    if (event.type !== 'session-started') {
      return event
    }

    return {
      ...event,
      transcriptPath,
      ...(repository === undefined ? {} : { repository }),
      currentState,
      states: [...states],
    }
  })

  if (enriched.some((event) => event.type === 'session-started')) {
    return enriched
  }

  return [{
    type: 'session-started',
    at: engineDeps.now(),
    transcriptPath,
    ...(repository === undefined ? {} : { repository }),
    currentState,
    states: [...states],
  }, ...enriched]
}
