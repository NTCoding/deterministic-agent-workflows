import type { SessionQueryDeps } from './session-queries'
import {
  openSqliteDatabase, type SqliteDatabase 
} from './sqlite-runtime'

const WORKFLOW_STATES = ['SPAWN', 'PLANNING', 'RESPAWN', 'DEVELOPING', 'REVIEWING', 'COMMITTING', 'CR_REVIEW', 'PR_CREATION', 'FEEDBACK', 'BLOCKED', 'COMPLETE']

export function createTestDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  db.exec(`
    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      label TEXT,
      agent_name TEXT,
      source_state TEXT,
      payload_json TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      review_type TEXT NOT NULL,
      verdict TEXT NOT NULL,
      branch TEXT,
      pull_request_number INTEGER,
      source_state TEXT,
      payload_json TEXT NOT NULL
    )
  `)
  return db
}

export function createTestQueryDeps(db?: SqliteDatabase): SessionQueryDeps {
  return { db: db ?? createTestDb() }
}

export function insertEvent(
  db: SqliteDatabase,
  sessionId: string,
  type: string,
  at: string,
  payload: Record<string, unknown> = {},
): void {
  db.prepare(
    'INSERT INTO events (session_id, type, at, payload) VALUES (?, ?, ?, ?)',
  ).run(sessionId, type, at, JSON.stringify({
    type,
    at,
    ...payload 
  }))
}

export function insertReflection(
  db: SqliteDatabase,
  sessionId: string,
  createdAt: string,
  payload: Record<string, unknown>,
  meta?: {
    readonly label?: string
    readonly agentName?: string
    readonly sourceState?: string
  },
): void {
  db.prepare(
    'INSERT INTO reflections (session_id, created_at, label, agent_name, source_state, payload_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    sessionId,
    createdAt,
    meta?.label ?? null,
    meta?.agentName ?? null,
    meta?.sourceState ?? null,
    JSON.stringify(payload),
  )
}

export function insertReview(
  db: SqliteDatabase,
  sessionId: string,
  createdAt: string,
  input: {
    readonly reviewType: string
    readonly verdict: 'PASS' | 'FAIL'
    readonly findings: ReadonlyArray<Record<string, unknown>>
    readonly summary?: string
    readonly branch?: string
    readonly pullRequestNumber?: number
    readonly sourceState?: string
  },
): void {
  db.prepare(
    'INSERT INTO reviews (session_id, created_at, review_type, verdict, branch, pull_request_number, source_state, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sessionId,
    createdAt,
    input.reviewType,
    input.verdict,
    input.branch ?? null,
    input.pullRequestNumber ?? null,
    input.sourceState ?? null,
    JSON.stringify({
      reviewType: input.reviewType,
      verdict: input.verdict,
      findings: input.findings,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.pullRequestNumber === undefined ? {} : { pullRequestNumber: input.pullRequestNumber }),
      ...(input.sourceState === undefined ? {} : { sourceState: input.sourceState }),
    }),
  )
}

export function seedSessionEvents(db: SqliteDatabase, sessionId: string): void {
  insertEvent(db, sessionId, 'session-started', '2026-01-01T00:00:00Z', {
    repository: 'test/repo',
    currentState: 'SPAWN',
    states: WORKFLOW_STATES,
  })
  insertEvent(db, sessionId, 'transitioned', '2026-01-01T00:01:00Z', {
    from: 'idle',
    to: 'SPAWN',
  })
  insertEvent(db, sessionId, 'agent-registered', '2026-01-01T00:02:00Z', {
    agentType: 'lead',
    agentId: 'lead-1',
  })
  insertEvent(db, sessionId, 'transitioned', '2026-01-01T00:05:00Z', {
    from: 'SPAWN',
    to: 'PLANNING',
  })
  insertEvent(db, sessionId, 'journal-entry', '2026-01-01T00:06:00Z', {
    agentName: 'lead-1',
    content: 'Starting plan',
  })
  insertEvent(db, sessionId, 'write-checked', '2026-01-01T00:07:00Z', {
    tool: 'Write',
    filePath: '/src/test.ts',
    allowed: false,
    reason: 'Not in DEVELOPING state',
  })
  insertEvent(db, sessionId, 'transitioned', '2026-01-01T00:10:00Z', {
    from: 'PLANNING',
    to: 'DEVELOPING',
  })
}

export function seedMultipleSessions(db: SqliteDatabase): void {
  seedSessionEvents(db, 'session-a')
  seedSessionEvents(db, 'session-b')

  insertEvent(db, 'session-b', 'transitioned', '2026-01-01T00:15:00Z', {
    from: 'DEVELOPING',
    to: 'REVIEWING',
  })
  insertEvent(db, 'session-b', 'bash-checked', '2026-01-01T00:16:00Z', {
    tool: 'Bash',
    command: 'git push',
    allowed: false,
    reason: 'Not in COMMITTING state',
  })
}

export function seedReviewSimulation(db: SqliteDatabase, sessionId = 'review-simulation'): void {
  seedSessionEvents(db, sessionId)
  insertEvent(db, sessionId, 'branch-recorded', '2026-01-01T00:11:00Z', { branch: 'feature/record-review' })
  insertEvent(db, sessionId, 'pr-recorded', '2026-01-01T00:12:00Z', { prNumber: 337 })

  insertReview(db, sessionId, '2026-01-01T00:13:00Z', {
    reviewType: 'architecture-review',
    verdict: 'FAIL',
    summary: 'Architecture boundaries leak runtime concerns.',
    branch: 'feature/record-review',
    pullRequestNumber: 337,
    sourceState: 'REVIEWING',
    findings: [{
      title: 'Runtime coupling crosses package boundary',
      severity: 'major',
      status: 'blocking',
      rule: 'ARCH-001',
      file: 'packages/deterministic-agent-workflows-cli/src/features/workflow-runner/entrypoint/workflow-runner.ts',
      startLine: 200,
      endLine: 260,
      details: 'Review command handling mixes persistence and workflow gating concerns.',
      recommendation: 'Move review persistence into a dedicated platform capability.',
    }],
  })
  insertEvent(db, sessionId, 'review-recorded', '2026-01-01T00:13:00Z', {
    reviewId: 1,
    reviewType: 'architecture-review',
    verdict: 'FAIL',
  })

  insertReview(db, sessionId, '2026-01-01T00:16:00Z', {
    reviewType: 'code-review',
    verdict: 'FAIL',
    summary: 'Comments and naming issues still block approval.',
    branch: 'feature/record-review',
    pullRequestNumber: 337,
    sourceState: 'REVIEWING',
    findings: [{
      title: 'Comments violate conventions',
      severity: 'major',
      status: 'blocking',
      rule: 'SD-006',
      file: 'packages/deterministic-agent-workflows-engine/src/platform/domain/review-types.ts',
      startLine: 1,
      endLine: 20,
      details: 'The file explains intent in comments instead of code.',
      recommendation: 'Remove comments and name types for the domain.',
    }],
  })
  insertEvent(db, sessionId, 'review-recorded', '2026-01-01T00:16:00Z', {
    reviewId: 2,
    reviewType: 'code-review',
    verdict: 'FAIL',
  })

  insertReview(db, sessionId, '2026-01-01T00:19:00Z', {
    reviewType: 'task-check',
    verdict: 'PASS',
    summary: 'Task scope is complete. Minor follow-up is documented.',
    branch: 'feature/record-review',
    pullRequestNumber: 337,
    sourceState: 'REVIEWING',
    findings: [{
      title: 'Screenshot refresh pending',
      severity: 'minor',
      status: 'non-blocking',
      rule: 'DOC-201',
      file: 'docs/control-center.png',
      details: 'The screenshot does not yet show the reviews view.',
      recommendation: 'Refresh the screenshot before release.',
    }],
  })
  insertEvent(db, sessionId, 'review-recorded', '2026-01-01T00:19:00Z', {
    reviewId: 3,
    reviewType: 'task-check',
    verdict: 'PASS',
  })

  insertReview(db, sessionId, '2026-01-01T00:22:00Z', {
    reviewType: 'code-review',
    verdict: 'PASS',
    summary: 'Blocking findings are resolved and the workflow may proceed.',
    branch: 'feature/record-review',
    pullRequestNumber: 337,
    sourceState: 'REVIEWING',
    findings: [],
  })
  insertEvent(db, sessionId, 'review-recorded', '2026-01-01T00:22:00Z', {
    reviewId: 4,
    reviewType: 'code-review',
    verdict: 'PASS',
  })
}
