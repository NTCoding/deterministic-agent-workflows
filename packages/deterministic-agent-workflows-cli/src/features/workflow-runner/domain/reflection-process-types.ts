/** @riviere-role value-object */
export type ReflectionProcess = {
  readonly schemaVersion: 1
  readonly context: {
    readonly sessionId: string
    readonly repository?: string
    readonly repositoryRoot?: string
    readonly transcriptPath?: string
    readonly eventStorePath?: string
    readonly currentState: string
  }
  readonly discovery: {
    readonly sources: ReadonlyArray<{
      readonly kind: 'repository-root' | 'transcript' | 'event-store'
      readonly path: string
      readonly sessionId?: string
    }>
  }
  readonly workflow: {
    readonly knownStates: ReadonlyArray<string>
    readonly observedEventTypes: ReadonlyArray<{
      readonly type: string
      readonly count: number
      readonly payloadKeys: ReadonlyArray<string>
    }>
  }
  readonly observations: {
    readonly stateDurations: {
      readonly totalDurationMs: number
      readonly states: ReadonlyArray<{
        readonly state: string
        readonly durationMs: number
        readonly percentageOfSession: number
        readonly entryCount: number
      }>
    }
    readonly transitions: {
      readonly transitions: ReadonlyArray<{
        readonly from: string
        readonly to: string
        readonly count: number
      }>
      readonly repeatedPaths: ReadonlyArray<{
        readonly path: ReadonlyArray<string>
        readonly count: number
      }>
    }
    readonly denials: {
      readonly total: number
      readonly byType: {
        readonly write: number
        readonly bash: number
        readonly pluginRead: number
        readonly idle: number
      }
      readonly byState: ReadonlyArray<{
        readonly state: string
        readonly count: number
      }>
    }
    readonly tools: {
      readonly usedToolNames: ReadonlyArray<string>
      readonly byState: ReadonlyArray<{
        readonly state: string
        readonly totalToolCalls: number
        readonly toolCounts: ReadonlyArray<{
          readonly name: string
          readonly count: number
        }>
      }>
    }
  }
  readonly instructions: {
    readonly objective: string
    readonly questionsToAnswer: ReadonlyArray<string>
    readonly constraints: ReadonlyArray<string>
    readonly recommendedSteps: ReadonlyArray<string>
  }
  readonly output: {
    readonly kind: 'reflection'
    readonly schemaVersion: 1
    readonly allowedCategories: ReadonlyArray<'state-efficiency' | 'review-rework' | 'quality-gates' | 'tooling' | 'workflow-design'>
    readonly maxFindings: 10
  }
}

/** @riviere-role value-object */
export type StatePeriod = {
  readonly state: string
  readonly startedAt: string
  readonly endedAt: string
  readonly durationMs: number
}
