/** @riviere-role domain-error */
export class WorkflowStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowStateError'
  }
}

/** @riviere-role value-object */
export type BaseWorkflowState<TStateName extends string = string> = { currentStateMachineState: TStateName }
