import type {
  PreconditionResult,
  WorkflowRegistry,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  pass,
  fail,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'

/** @riviere-role domain-service */
export function checkOperationGate<
  TStateName extends string,
  TState extends { currentStateMachineState: TStateName },
  TOperation extends string,
>(
  op: TOperation,
  state: TState,
  registry: WorkflowRegistry<TState, TStateName, TOperation>,
): PreconditionResult {
  const stateName = state.currentStateMachineState
  const stateDef = registry[stateName]
  if (stateDef.allowedWorkflowOperations.includes(op)) {
    return pass()
  }
  return fail(`${op} is not allowed in state ${state.currentStateMachineState}.`)
}

/** @riviere-role value-object */
export type RecordingOpDefinition<TArgs extends readonly unknown[]> = {
  readonly event: string
  readonly payload: { bivarianceHack: (...args: TArgs) => Record<string, unknown> }['bivarianceHack']
}

/** @riviere-role value-object */
export type RecordingOpResult =
  | {
    readonly pass: true;
    readonly event: {
      readonly type: string;
      readonly at: string 
    } & Record<string, unknown> 
  }
  | {
    readonly pass: false;
    readonly reason: string 
  }

/** @riviere-role value-object */
export type RecordingOpsFactory<
  TStateName extends string,
  TState extends { currentStateMachineState: TStateName },
  TOperation extends string,
> = {
  readonly executeOp: (
    opName: TOperation,
    state: TState,
    now: string,
    args: readonly unknown[],
  ) => RecordingOpResult
}

/** @riviere-role domain-service */
export function defineRecordingOps<
  TStateName extends string,
  TState extends { currentStateMachineState: TStateName },
  TOperation extends string,
>(
  registry: WorkflowRegistry<TState, TStateName, TOperation>,
  ops: { readonly [K in string]: RecordingOpDefinition<readonly never[]> },
): RecordingOpsFactory<TStateName, TState, TOperation> {
  return {
    executeOp: (
      opName: TOperation,
      state: TState,
      now: string,
      args: readonly unknown[],
    ): RecordingOpResult => {
      const gate = checkOperationGate(opName, state, registry)
      if (!gate.pass) {
        return {
          pass: false,
          reason: gate.reason,
        }
      }
      const opDef = Object.hasOwn(ops, opName)
        ? ops[opName]
        : undefined
      if (opDef === undefined) {
        return {
          pass: false,
          reason: `Unknown recording operation: ${opName}`,
        }
      }
      // @ts-expect-error Runtime args are forwarded to the consumer-defined payload factory unchanged.
      const payload = opDef.payload(...args)
      return {
        pass: true,
        event: {
          type: opDef.event,
          at: now,
          ...payload,
        },
      }
    },
  }
}
