import type { EngineResult } from './workflow-engine-types'

/** @riviere-role domain-service */
export function serializeWorkflowState(state: unknown): EngineResult {
  try {
    return {
      type: 'success',
      output: JSON.stringify(state, null, 2),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      type: 'error',
      output: `Failed to serialize workflow state: ${message}`,
    }
  }
}
