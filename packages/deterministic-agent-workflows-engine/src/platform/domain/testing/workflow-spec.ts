/** @riviere-role value-object */
export type SpecConfig<TEvent, TState, TDeps, TWorkflow> = {
  readonly fold: (events: readonly TEvent[]) => TState
  readonly rehydrate: (state: TState, deps: TDeps) => TWorkflow
  readonly defaultDeps: () => TDeps
  readonly getPendingEvents: (wf: TWorkflow) => readonly TEvent[]
  readonly getState: (wf: TWorkflow) => TState
  readonly mergeDeps: (defaults: TDeps, overrides: Partial<TDeps>) => TDeps
}

/** @riviere-role value-object */
export type OperationResult<TEvent, TState, TResult> = {
  readonly result: TResult
  readonly events: readonly TEvent[]
  readonly state: TState
}

/** @riviere-role value-object */
export type ThrowResult = { readonly error: unknown }

/** @riviere-role value-object */
export type GivenPhase<TEvent, TState, TDeps, TWorkflow> = {
  readonly withDeps: (overrides: Partial<TDeps>) => GivenPhase<
    TEvent,
    TState,
    TDeps,
    TWorkflow
  >
  readonly when: <TResult>(op: (wf: TWorkflow) => TResult) => OperationResult<TEvent, TState, TResult>
  readonly whenThrows: (op: (wf: TWorkflow) => unknown) => ThrowResult
}

/** @riviere-role value-object */
export type WorkflowSpecification<TEvent, TState, TDeps, TWorkflow> = {
  readonly given: (...events: readonly TEvent[]) => GivenPhase<
    TEvent,
    TState,
    TDeps,
    TWorkflow
  >
}

/** @riviere-role domain-error */
export class WorkflowSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowSpecError'
  }
}

const EMPTY_OVERRIDES = Object.freeze({})

/** @riviere-role domain-service */
export function workflowSpec<TEvent, TState, TDeps, TWorkflow>(
  config: SpecConfig<TEvent, TState, TDeps, TWorkflow>,
): WorkflowSpecification<TEvent, TState, TDeps, TWorkflow> {
  function buildGiven(
    events: readonly TEvent[],
    depOverrides: Partial<TDeps>,
  ): GivenPhase<TEvent, TState, TDeps, TWorkflow> {
    const resolveDeps = (): TDeps => config.mergeDeps(config.defaultDeps(), depOverrides)

    const rehydrate = (): TWorkflow => {
      const state = config.fold(events)
      return config.rehydrate(state, resolveDeps())
    }

    return {
      withDeps: (overrides) => buildGiven(
        events,
        {
          ...depOverrides,
          ...overrides,
        },
      ),
      when: (op) => {
        const wf = rehydrate()
        const result = op(wf)
        return {
          result,
          events: config.getPendingEvents(wf),
          state: config.getState(wf),
        }
      },
      whenThrows: (op) => {
        const wf = rehydrate()
        try {
          op(wf)
        } catch (error: unknown) {
          return { error }
        }
        throw new WorkflowSpecError('Expected operation to throw, but it did not')
      },
    }
  }

  return { given: (...events) => buildGiven(events, EMPTY_OVERRIDES) }
}
