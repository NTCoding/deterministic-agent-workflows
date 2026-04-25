declare module '@nt-ai-lab/deterministic-agent-workflow-engine' {
  import type { z } from 'zod'

  export const engineEventSchema: z.ZodType<EngineEvent>
  export const repositoryMetadataEventSchema: z.ZodType<DomainMetadataEvent>
  export const storedReflectionSchema: z.ZodType<StoredReflection>

  export type EngineEvent =
    | {
      type: 'session-started'
      at: string
      transcriptPath?: string
      repository?: string
      currentState?: string
      states?: Array<string>
    }
    | {
      type: 'transitioned'
      at: string
      from: string
      to: string
      preBlockedState?: string
      iteration?: number
      developingHeadCommit?: string
      developerDone?: boolean
    }
    | { type: 'agent-registered'; at: string; agentType: string; agentId: string }
    | { type: 'agent-shut-down'; at: string; agentName: string }
    | { type: 'journal-entry'; at: string; agentName: string; content: string }
    | {
      type: 'write-checked'
      at: string
      tool: string
      filePath: string
      allowed: boolean
      reason?: string
    }
    | {
      type: 'bash-checked'
      at: string
      tool: string
      command: string
      allowed: boolean
      reason?: string
    }
    | {
      type: 'plugin-read-checked'
      at: string
      tool: string
      path: string
      allowed: boolean
      reason?: string
    }
    | { type: 'idle-checked'; at: string; agentName: string; allowed: boolean; reason?: string }
    | { type: 'identity-verified'; at: string; status: string; transcriptPath: string }
    | { type: 'context-requested'; at: string; agentName: string }
    | { type: 'review-recorded'; at: string; reviewId: number; reviewType: string; verdict: 'PASS' | 'FAIL' }

  export type DomainMetadataEvent =
    | { type: 'issue-recorded'; at: string; issueNumber: number }
    | { type: 'branch-recorded'; at: string; branch: string }
    | { type: 'pr-recorded'; at: string; prNumber: number }

  export type ReflectionEvidence =
    | {
      kind: 'state-period'
      label?: string
      state: string
      startedAt?: string
      endedAt?: string
    }
    | { kind: 'event'; label?: string; seq: number }
    | { kind: 'event-range'; label?: string; startSeq: number; endSeq: number }
    | { kind: 'journal-entry'; label?: string; at: string; agentName?: string }
    | { kind: 'transcript-range'; label?: string; startIndex: number; endIndex: number }
    | { kind: 'tool-activity'; label?: string; state?: string; toolName?: string; metric?: string }

  export type ReflectionFinding = {
    title: string
    category: 'state-efficiency' | 'review-rework' | 'quality-gates' | 'tooling' | 'workflow-design'
    opportunity: string
    likelyCause: string
    suggestedChange: string
    expectedImpact: string
    confidence?: 'low' | 'medium' | 'high'
    evidence: Array<ReflectionEvidence>
  }

  export type ReflectionPayload = {
    summary?: string
    findings: Array<ReflectionFinding>
  }

  export type StoredReflection = {
    id: number
    sessionId: string
    createdAt: string
    label?: string
    agentName?: string
    sourceState?: string
    reflection: ReflectionPayload
  }

  export type ReviewType = string

  export type ReviewVerdict = 'PASS' | 'FAIL'

  export type ReviewFinding = {
    title?: string
    severity?: 'minor' | 'major' | 'critical'
    status?: 'blocking' | 'non-blocking' | 'accepted-risk'
    rule?: string
    file?: string
    startLine?: number
    endLine?: number
    details?: string
    recommendation?: string
  }

  export type StoredReview = {
    id: number
    sessionId: string
    createdAt: string
    reviewType: ReviewType
    verdict: ReviewVerdict
    branch?: string
    pullRequestNumber?: number
    sourceState?: string
    summary?: string
    findings: Array<ReviewFinding>
  }

  export type ListedReview = StoredReview & {
    repository?: string
  }

  export type ReviewFilters = {
    repository?: string
    branch?: string
    pullRequestNumber?: number
    reviewType?: ReviewType
    verdict?: ReviewVerdict
  }
}

declare module '@nt-ai-lab/deterministic-agent-workflow-event-store' {
  export type SqliteStatement = {
    readonly all: (...params: readonly unknown[]) => readonly unknown[]
    readonly get: (...params: readonly unknown[]) => unknown | undefined
    readonly run: (...params: readonly unknown[]) => unknown
  }

  export type SqliteDatabase = {
    readonly prepare: (sql: string) => SqliteStatement
    readonly exec: (sql: string) => void
    readonly close: () => void
  }

  export function openSqliteDatabase(path: string, options?: { readonly?: boolean }): SqliteDatabase
  export function enableWalMode(database: SqliteDatabase): void
}
