declare module '@nt-ai-lab/deterministic-agent-workflow-engine' {
  import type { z } from 'zod'

  export const engineEventSchema: z.ZodType<EngineEvent>
  export const repositoryMetadataEventSchema: z.ZodType<DomainMetadataEvent>

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

  export type DomainMetadataEvent =
    | { type: 'issue-recorded'; at: string; issueNumber: number }
    | { type: 'branch-recorded'; at: string; branch: string }
    | { type: 'pr-recorded'; at: string; prNumber: number }
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
