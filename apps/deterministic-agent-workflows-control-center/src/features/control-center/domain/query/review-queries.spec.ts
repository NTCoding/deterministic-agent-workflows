import {
  describe,
  expect,
  it,
} from 'vitest'
import {
  getSessionReviews,
  listReviews,
} from './review-queries'
import {
  createTestDb,
  createTestQueryDeps,
  insertEvent,
  insertReview,
  seedReviewSimulation,
} from './session-queries-test-fixtures'
import { openSqliteDatabase } from './sqlite-runtime'
import type { SqliteDatabase } from './sqlite-runtime'

function createReviewDeps(rows: ReadonlyArray<unknown>, hasTable = true): { readonly db: SqliteDatabase } {
  return {
    db: {
      prepare: (sql: string) => ({
        all: () => {
          if (sql.includes('sqlite_master')) {
            return hasTable ? [{ name: 'reviews' }] : []
          }
          return rows
        },
        get: () => undefined,
        run: () => undefined,
      }),
      exec: () => undefined,
      close: () => undefined,
    },
  }
}

describe('review-queries', () => {
  it('returns empty array when reviews table is absent', () => {
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
    expect(getSessionReviews(createTestQueryDeps(db), 'test-1')).toStrictEqual([])
    expect(listReviews(createTestQueryDeps(db), {})).toStrictEqual([])
    db.close()
  })

  it('returns reviews when table is created after an empty lookup', () => {
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
    const deps = createTestQueryDeps(db)
    expect(listReviews(deps, {})).toStrictEqual([])
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
    insertEvent(db, 'test-1', 'session-started', '2026-01-01T00:00:00Z', { repository: 'test/repo' })
    insertReview(db, 'test-1', '2026-01-01T00:01:00Z', {
      reviewType: 'custom-review',
      verdict: 'PASS',
      branch: 'feature/review',
      pullRequestNumber: 1,
      sourceState: 'REVIEWING',
      findings: [],
    })

    expect(listReviews(deps, {})).toStrictEqual([{
      id: 1,
      sessionId: 'test-1',
      createdAt: '2026-01-01T00:01:00Z',
      reviewType: 'custom-review',
      verdict: 'PASS',
      repository: 'test/repo',
      branch: 'feature/review',
      pullRequestNumber: 1,
      sourceState: 'REVIEWING',
      findings: [],
    }])
    db.close()
  })

  it('returns session reviews in chronological order', () => {
    const db = createTestDb()
    insertReview(db, 'test-1', '2026-01-01T00:10:00Z', {
      reviewType: 'code-review',
      verdict: 'FAIL',
      findings: [],
    })
    insertReview(db, 'test-1', '2026-01-01T00:20:00Z', {
      reviewType: 'code-review',
      verdict: 'PASS',
      findings: [],
    })

    const reviews = getSessionReviews(createTestQueryDeps(db), 'test-1')
    expect(reviews.map((review) => review.createdAt)).toStrictEqual([
      '2026-01-01T00:10:00Z',
      '2026-01-01T00:20:00Z',
    ])
    db.close()
  })

  it('filters cross-session reviews by repository branch pr type and verdict', () => {
    const db = createTestDb()
    seedReviewSimulation(db, 'session-a')
    seedReviewSimulation(db, 'session-b')

    const filtered = listReviews(createTestQueryDeps(db), {
      repository: 'test/repo',
      branch: 'feature/record-review',
      pullRequestNumber: 337,
      reviewType: 'code-review',
      verdict: 'FAIL',
    })

    expect(filtered).toHaveLength(2)
    expect(filtered.every((review) => review.reviewType === 'code-review')).toBe(true)
    expect(filtered.every((review) => review.verdict === 'FAIL')).toBe(true)
    db.close()
  })

  it('returns all listed reviews when filters are empty', () => {
    const db = createTestDb()
    seedReviewSimulation(db, 'session-a')
    const reviews = listReviews(createTestQueryDeps(db), {})
    expect(reviews).toHaveLength(4)
    expect(reviews.map((review) => review.createdAt)).toStrictEqual([
      '2026-01-01T00:22:00Z',
      '2026-01-01T00:19:00Z',
      '2026-01-01T00:16:00Z',
      '2026-01-01T00:13:00Z',
    ])
    db.close()
  })

  it('throws when session review row is not an object', () => {
    expect(() => getSessionReviews(createReviewDeps(['bad-row']), 'test-1')).toThrow('Expected review row.')
  })

  it('throws when listed review row is not an object', () => {
    expect(() => listReviews(createReviewDeps(['bad-row']), {})).toThrow('Expected listed review row.')
  })

  it('throws when payload_json is not a string', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: 42,
    }]), 'test-1')).toThrow('Expected review payload_json string.')
  })

  it('throws when listed payload_json is not a string', () => {
    expect(() => listReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      repository: 'test/repo',
      payload_json: 42,
    }]), {})).toThrow('Expected review payload_json string.')
  })

  it('throws when review id is not numeric', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 'bad',
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [] }),
    }]), 'test-1')).toThrow('Expected numeric id.')
  })

  it('throws when required review strings are empty', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: '',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [] }),
    }]), 'test-1')).toThrow('Expected string session_id.')
  })

  it('throws when review verdict is invalid', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'MAYBE',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [] }),
    }]), 'test-1')).toThrow('Expected review verdict.')
  })

  it('throws when optional review string is empty', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: '',
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [] }),
    }]), 'test-1')).toThrow('Expected optional string branch.')
  })

  it('throws when optional review number is not positive integer', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: 0,
      source_state: null,
      payload_json: JSON.stringify({ findings: [] }),
    }]), 'test-1')).toThrow('Expected optional positive integer pull_request_number.')
  })

  it('throws when review payload is not an object', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify('bad-payload'),
    }]), 'test-1')).toThrow('Expected review payload object.')
  })

  it('throws when review findings is not an array', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: 'bad-findings' }),
    }]), 'test-1')).toThrow('Expected review findings array.')
  })

  it('throws when review finding is not an object', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: ['bad-finding'] }),
    }]), 'test-1')).toThrow('Expected review finding.')
  })

  it('throws when review finding severity is invalid', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [{ severity: 'urgent' }] }),
    }]), 'test-1')).toThrow('Expected review finding severity.')
  })

  it('throws when review finding status is invalid', () => {
    expect(() => getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [{ status: 'deferred' }] }),
    }]), 'test-1')).toThrow('Expected review finding status.')
  })

  it('preserves optional review finding fields', () => {
    const reviews = getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'FAIL',
      branch: 'feature/x',
      pull_request_number: 9,
      source_state: 'REVIEWING',
      payload_json: JSON.stringify({
        summary: 'summary',
        findings: [{
          title: 'title',
          severity: 'major',
          status: 'blocking',
          rule: 'RULE-1',
          file: 'src/file.ts',
          startLine: 1,
          endLine: 2,
          details: 'details',
          recommendation: 'recommendation',
        }],
      }),
    }]), 'test-1')

    expect(reviews[0]).toStrictEqual({
      id: 1,
      sessionId: 'test-1',
      createdAt: '2026-01-01T00:00:00Z',
      reviewType: 'custom-review',
      verdict: 'FAIL',
      branch: 'feature/x',
      pullRequestNumber: 9,
      sourceState: 'REVIEWING',
      summary: 'summary',
      findings: [{
        title: 'title',
        severity: 'major',
        status: 'blocking',
        rule: 'RULE-1',
        file: 'src/file.ts',
        startLine: 1,
        endLine: 2,
        details: 'details',
        recommendation: 'recommendation',
      }],
    })
  })

  it('omits absent listed review metadata', () => {
    const reviews = listReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      repository: null,
      payload_json: JSON.stringify({ findings: [] }),
    }]), {})

    expect(reviews[0]).toStrictEqual({
      id: 1,
      sessionId: 'test-1',
      createdAt: '2026-01-01T00:00:00Z',
      reviewType: 'custom-review',
      verdict: 'PASS',
      findings: [],
    })
  })

  it('accepts finding records with only optional fields omitted', () => {
    const reviews = getSessionReviews(createReviewDeps([{
      id: 1,
      session_id: 'test-1',
      created_at: '2026-01-01T00:00:00Z',
      review_type: 'custom-review',
      verdict: 'PASS',
      branch: null,
      pull_request_number: null,
      source_state: null,
      payload_json: JSON.stringify({ findings: [{}] }),
    }]), 'test-1')

    expect(reviews[0]?.findings).toStrictEqual([{}])
  })
})
