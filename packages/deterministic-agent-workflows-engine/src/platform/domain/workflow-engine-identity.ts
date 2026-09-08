import { checkIdentity } from './identity-verification'
import type { BaseWorkflowState } from './workflow-state'
import type {
  TransitionContext,
  WorkflowRegistry,
} from './workflow-registry'
import {
  buildPrefixPattern,
  getExpectedPrefix,
  readProcedure,
} from './workflow-engine-support'
import type { WorkflowEngineDeps } from './workflow-engine-types'

type IdentityVerificationDeps<TState extends BaseWorkflowState<string>, TTransitionContext extends TransitionContext<TState, string>> = {
  readonly engineDeps: WorkflowEngineDeps
  readonly registry: WorkflowRegistry<TState, string, string, TTransitionContext>
  readonly persistPlatformEvent: (event: unknown) => void
  readonly getTranscriptPath: () => string
  readonly getState: () => TState
}

/** @riviere-role domain-service */
export function verifyAgentIdentity<TState extends BaseWorkflowState<string>, TTransitionContext extends TransitionContext<TState, string>>(
  deps: IdentityVerificationDeps<TState, TTransitionContext>,
): string | undefined {
  const transcriptPath = deps.getTranscriptPath()
  const state = deps.getState().currentStateMachineState
  const pattern = buildPrefixPattern(deps.registry)
  const messages = deps.engineDeps.transcriptReader.readMessages(transcriptPath)
  const identityCheckResult = checkIdentity(messages, pattern)

  deps.persistPlatformEvent({
    type: 'identity-verified',
    at: deps.engineDeps.now(),
    status: identityCheckResult.status,
    transcriptPath,
  })

  if (identityCheckResult.status !== 'lost') return undefined
  const currentProcedure = readProcedure(deps.engineDeps, state)
  return [
    'Your last message is missing the required state prefix.',
    '',
    `- send a new message starting with: ${getExpectedPrefix(state, deps.registry)}`,
    '- then continue with the current procedure',
    '',
    'Current procedure:',
    '',
    currentProcedure,
  ].join('\n')
}
