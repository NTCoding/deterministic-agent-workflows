import type {
  ListedReview,
  ReviewFinding,
  ReviewFilters,
  StoredReview,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { SessionQueryDeps } from './session-queries'
import type { SqliteDatabase } from './sqlite-runtime'

const reviewsTableCache = new WeakMap<SqliteDatabase, boolean>()

function hasReviewsTable(db: SqliteDatabase): boolean {
  const cached = reviewsTableCache.get(db)
  if (cached !== undefined) return cached
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reviews'").all()
  const has = rows.some((row) => isRecord(row) && row['name'] === 'reviews')
  reviewsTableCache.set(db, has)
  return has
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRequiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number') {
    throw new TypeError(`Expected numeric ${key}.`)
  }
  return value
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Expected string ${key}.`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function parseReviewVerdict(value: string): StoredReview['verdict'] {
  if (value === 'PASS' || value === 'FAIL') {
    return value
  }
  throw new TypeError('Expected review verdict.')
}

function parseReviewFindingSeverity(value: string | undefined): ReviewFinding['severity'] | undefined {
  if (value === undefined) return undefined
  if (value === 'minor' || value === 'major' || value === 'critical') {
    return value
  }
  throw new TypeError('Expected review finding severity.')
}

function parseReviewFindingStatus(value: string | undefined): ReviewFinding['status'] | undefined {
  if (value === undefined) return undefined
  if (value === 'blocking' || value === 'non-blocking' || value === 'accepted-risk') {
    return value
  }
  throw new TypeError('Expected review finding status.')
}

function parseReviewFindings(payload: Record<string, unknown>): Array<ReviewFinding> {
  const findings = payload['findings']
  if (!Array.isArray(findings)) {
    throw new TypeError('Expected review findings array.')
  }
  return findings.map(parseReviewFinding)
}

function parseReviewFinding(value: unknown): ReviewFinding {
  if (!isRecord(value)) {
    throw new TypeError('Expected review finding.')
  }
  const title = readOptionalString(value, 'title')
  const severity = parseReviewFindingSeverity(readOptionalString(value, 'severity'))
  const status = parseReviewFindingStatus(readOptionalString(value, 'status'))
  const rule = readOptionalString(value, 'rule')
  const file = readOptionalString(value, 'file')
  const startLine = readOptionalNumber(value, 'startLine')
  const endLine = readOptionalNumber(value, 'endLine')
  const details = readOptionalString(value, 'details')
  const recommendation = readOptionalString(value, 'recommendation')
  return {
    ...(title === undefined ? {} : { title }),
    ...(severity === undefined ? {} : { severity }),
    ...(status === undefined ? {} : { status }),
    ...(rule === undefined ? {} : { rule }),
    ...(file === undefined ? {} : { file }),
    ...(startLine === undefined ? {} : { startLine }),
    ...(endLine === undefined ? {} : { endLine }),
    ...(details === undefined ? {} : { details }),
    ...(recommendation === undefined ? {} : { recommendation }),
  }
}

function parseReviewPayload(payloadJson: string): {
  readonly summary?: string
  readonly findings: Array<ReviewFinding>
} {
  const payload: unknown = JSON.parse(payloadJson)
  if (!isRecord(payload)) {
    throw new TypeError('Expected review payload object.')
  }
  const summary = readOptionalString(payload, 'summary')
  return {
    ...(summary === undefined ? {} : { summary }),
    findings: parseReviewFindings(payload),
  }
}

function parseStoredReviewRow(row: unknown): StoredReview {
  if (!isRecord(row)) {
    throw new TypeError('Expected review row.')
  }
  const payload = row['payload_json']
  if (typeof payload !== 'string') {
    throw new TypeError('Expected review payload_json string.')
  }
  const branch = readOptionalString(row, 'branch')
  const pullRequestNumber = readOptionalNumber(row, 'pull_request_number')
  const sourceState = readOptionalString(row, 'source_state')
  return {
    id: readRequiredNumber(row, 'id'),
    sessionId: readRequiredString(row, 'session_id'),
    createdAt: readRequiredString(row, 'created_at'),
    reviewType: readRequiredString(row, 'review_type'),
    verdict: parseReviewVerdict(readRequiredString(row, 'verdict')),
    ...(branch === undefined ? {} : { branch }),
    ...(pullRequestNumber === undefined ? {} : { pullRequestNumber }),
    ...(sourceState === undefined ? {} : { sourceState }),
    ...parseReviewPayload(payload),
  }
}

function parseListedReviewRow(row: unknown): ListedReview {
  if (!isRecord(row)) {
    throw new TypeError('Expected listed review row.')
  }
  const payload = row['payload_json']
  if (typeof payload !== 'string') {
    throw new TypeError('Expected review payload_json string.')
  }
  const repository = readOptionalString(row, 'repository')
  const branch = readOptionalString(row, 'branch')
  const pullRequestNumber = readOptionalNumber(row, 'pull_request_number')
  const sourceState = readOptionalString(row, 'source_state')
  return {
    id: readRequiredNumber(row, 'id'),
    sessionId: readRequiredString(row, 'session_id'),
    createdAt: readRequiredString(row, 'created_at'),
    reviewType: readRequiredString(row, 'review_type'),
    verdict: parseReviewVerdict(readRequiredString(row, 'verdict')),
    ...(repository === undefined ? {} : { repository }),
    ...(branch === undefined ? {} : { branch }),
    ...(pullRequestNumber === undefined ? {} : { pullRequestNumber }),
    ...(sourceState === undefined ? {} : { sourceState }),
    ...parseReviewPayload(payload),
  }
}

function buildReviewFilters(filters: ReviewFilters): {
  readonly conditions: ReadonlyArray<string>
  readonly parameters: ReadonlyArray<string | number>
} {
  const conditions: Array<string> = []
  const parameters: Array<string | number> = []

  if (filters.repository !== undefined) {
    conditions.push(`(
      SELECT json_extract(events.payload, '$.repository')
      FROM events
      WHERE events.session_id = reviews.session_id AND events.type = 'session-started'
      ORDER BY events.seq ASC
      LIMIT 1
    ) = ?`)
    parameters.push(filters.repository)
  }
  if (filters.branch !== undefined) {
    conditions.push('reviews.branch = ?')
    parameters.push(filters.branch)
  }
  if (filters.pullRequestNumber !== undefined) {
    conditions.push('reviews.pull_request_number = ?')
    parameters.push(filters.pullRequestNumber)
  }
  if (filters.reviewType !== undefined) {
    conditions.push('reviews.review_type = ?')
    parameters.push(filters.reviewType)
  }
  if (filters.verdict !== undefined) {
    conditions.push('reviews.verdict = ?')
    parameters.push(filters.verdict)
  }

  return {
    conditions,
    parameters,
  }
}

/** @riviere-role query-model */
export function getSessionReviews(
  deps: SessionQueryDeps,
  sessionId: string,
): ReadonlyArray<StoredReview> {
  if (!hasReviewsTable(deps.db)) return []
  const rows = deps.db
    .prepare('SELECT id, session_id, created_at, review_type, verdict, branch, pull_request_number, source_state, payload_json FROM reviews WHERE session_id = ? ORDER BY created_at ASC, id ASC')
    .all(sessionId)
  return rows.map(parseStoredReviewRow)
}

/** @riviere-role query-model */
export function listReviews(
  deps: SessionQueryDeps,
  filters: ReviewFilters,
): ReadonlyArray<ListedReview> {
  if (!hasReviewsTable(deps.db)) return []
  const parsedFilters = buildReviewFilters(filters)
  const whereClause = parsedFilters.conditions.length === 0
    ? ''
    : `WHERE ${parsedFilters.conditions.join(' AND ')}`
  const rows = deps.db.prepare(`
    SELECT
      reviews.id,
      reviews.session_id,
      reviews.created_at,
      reviews.review_type,
      reviews.verdict,
      reviews.branch,
      reviews.pull_request_number,
      reviews.source_state,
      reviews.payload_json,
      (
        SELECT json_extract(events.payload, '$.repository')
        FROM events
        WHERE events.session_id = reviews.session_id AND events.type = 'session-started'
        ORDER BY events.seq ASC
        LIMIT 1
      ) AS repository
    FROM reviews
    ${whereClause}
    ORDER BY reviews.created_at DESC, reviews.id DESC
  `).all(...parsedFilters.parameters)
  return rows.map(parseListedReviewRow)
}
