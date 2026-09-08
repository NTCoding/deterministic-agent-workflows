import type { EngineResult } from './workflow-engine-types'

/** @riviere-role domain-service */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** @riviere-role domain-service */
export function formatUncommittedOperationError(error: unknown): EngineResult {
  return {
    type: 'error',
    output: `Workflow operation failed before persistence: ${errorMessage(error)}`,
    persistence: 'not-attempted',
  }
}

/** @riviere-role domain-service */
export function formatCommittedResponseError(error: unknown): EngineResult {
  return {
    type: 'error',
    output: `Workflow operation committed, but its response could not be completed: ${errorMessage(error)}`,
    persistence: 'committed',
  }
}
