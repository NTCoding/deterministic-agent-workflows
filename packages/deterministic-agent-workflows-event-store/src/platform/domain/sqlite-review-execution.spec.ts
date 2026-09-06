import {
  mkdtempSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describe, expect, it
} from 'vitest'
import { createStore } from './sqlite-event-store'
import { createSqliteReviewJobStore } from './sqlite-review-job-store'

function withConnections(run: (first: ReturnType<typeof createStore>, second: ReturnType<typeof createStore>, directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'sqlite-execution-'))
  const path = join(directory, 'events.db')
  const first = createStore(path)
  const alias = join(directory, 'alias.db')
  symlinkSync(path, alias)
  const second = createStore(alias)
  try { run(first, second, directory) } finally {
    first.db.close()
    second.db.close()
    rmSync(directory, {
      recursive: true,
      force: true
    })
  }
}

describe('exclusive review execution', () => {
  it('excludes competing connections including aliases without blocking main database writes', () => {
    withConnections((first, second) => {
      const release = first.claimReviewExecution('bundle')
      try {
        expect(() => second.claimReviewExecution('bundle')).toThrow('Unable to claim SQLite exclusive lock')
        expect(() => second.claimReviewExecution('bundle')).toThrow('Unable to claim SQLite exclusive lock')
        second.db.exec('CREATE TABLE fixture (value TEXT)')
        const releaseOther = second.claimReviewExecution('other-bundle')
        releaseOther()
        expect(() => first.claimReviewExecution('')).toThrow('String must contain at least 1 character(s)')
      } finally { release() }
      const releaseSecond = second.claimReviewExecution('bundle')
      try {
        release()
        expect(() => first.claimReviewExecution('bundle')).toThrow('Unable to claim SQLite exclusive lock')
      } finally { releaseSecond() }
    })
  })

  it('shares ownership for one in-memory connection but not independent in-memory databases', () => {
    const first = createStore(':memory:')
    const second = createStore(':memory:')
    const sameConnection = createSqliteReviewJobStore(first.db)
    try {
      const releaseFirst = first.claimReviewExecution('bundle')
      try {
        expect(() => sameConnection.claimReviewExecution('bundle')).toThrow('Lock is already held')
        const releaseOther = second.claimReviewExecution('bundle')
        releaseOther()
      } finally { releaseFirst() }
      const releaseNext = sameConnection.claimReviewExecution('bundle')
      try {
        releaseFirst()
        expect(() => first.claimReviewExecution('bundle')).toThrow('Lock is already held')
      } finally { releaseNext() }
    } finally { first.db.close(); second.db.close() }
  })
})


it('fails closed if the lock directory cannot be created', () => {
  withConnections((first, _second, directory) => {
    writeFileSync(join(directory, 'events.db.locks'), 'not a directory')
    expect(() => first.claimReviewExecution('bundle')).toThrow('EEXIST')
  })
})
