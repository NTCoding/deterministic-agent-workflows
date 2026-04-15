import type { BaseEvent } from './base-event'
import type { PreconditionResult } from './precondition-result'
import {
  fail, pass 
} from './precondition-result'
import type { BaseWorkflowState } from './workflow-state'
import type { RehydratableWorkflow } from './workflow-engine-types'

/** @riviere-role value-object */
export interface BaseWorkflowDeps {readonly now: () => string}

/**
 * Platform base class for consumer workflows.
 *
 * Provides the pending-event buffer and a built-in `writeJournal` operation so
 * every consumer gets platform journaling for free. Consumers extend this and
 * implement the domain-specific abstract methods.
 *
 * @riviere-role domain-aggregate
 */
export abstract class BaseWorkflow<TState extends BaseWorkflowState>
implements RehydratableWorkflow<TState> {
  private readonly pending: BaseEvent[] = []

  constructor(protected readonly baseDeps: BaseWorkflowDeps) {}

  abstract getState(): TState
  abstract startSession(transcriptPath: string, repository: string | undefined): void
  abstract getTranscriptPath(): string
  abstract registerAgent(agentType: string, agentId: string): PreconditionResult
  abstract handleTeammateIdle(agentName: string): PreconditionResult

  appendEvent(event: BaseEvent): void {
    this.pending.push(event)
  }

  getPendingEvents(): readonly BaseEvent[] {
    return this.pending
  }

  writeJournal(agentName: string, content: string): PreconditionResult {
    if (!agentName) return fail('write-journal: agent-name cannot be empty')
    if (!content) return fail('write-journal: content cannot be empty')
    this.appendEvent({
      type: 'journal-entry',
      at: this.baseDeps.now(),
      agentName,
      content,
    })
    return pass()
  }
}
