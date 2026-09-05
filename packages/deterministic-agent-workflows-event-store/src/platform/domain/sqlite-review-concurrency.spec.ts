import { createHash } from 'node:crypto'
import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  afterEach, describe, expect, it
} from 'vitest'
import { z } from 'zod'
import { createStore } from './sqlite-event-store'

const directories: string[] = []
const at = '2026-01-01T00:00:00.000Z'
const changedFiles = ['src/file.ts']
const request = {
  bundleId: 'bundle',
  sessionId: 'workflow',
  repository: 'owner/repository',
  workingDirectory: '/repository',
  pullRequestNumber: 42,
  baseRevision: 'base',
  headRevision: 'head',
  changedFiles,
  stateInstructions: 'Review the change.',
  reviews: [{
    reviewType: 'custom-review',
    instructions: 'Inspect correctness.',
    version: 'v1',
  }],
}
const provenance = {
  bundleId: request.bundleId,
  providerSessionId: 'provider-session',
  providerRunId: 'provider-run',
  baseRevision: request.baseRevision,
  headRevision: request.headRevision,
  exactFiles: changedFiles,
  exactFilesDigest: createHash('sha256').update(JSON.stringify(changedFiles)).digest('hex'),
  reviewerDefinitionVersion: 'v1',
}
const workerResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted') }),
  z.object({
    type: z.literal('rejected'),
    reason: z.string(),
  }),
])

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'review-concurrency-'))
  directories.push(directory)
  const path = join(directory, 'events.db')
  const store = createStore(path)
  return {
    path,
    store,
  }
}

function startBundle(store: ReturnType<typeof createStore>) {
  store.claimReviewBundle(request, at)
  store.markReviewBundleRunning(request.bundleId, at)
  store.markReviewAgentRunning(
    request.bundleId,
    'custom-review',
    provenance.providerSessionId,
    provenance.providerRunId,
    at,
  )
}

function readWorkerResult(worker: Worker): Promise<z.infer<typeof workerResultSchema>> {
  return new Promise((resolve, reject) => {
    worker.once('message', (message: unknown) => {
      const parsed = workerResultSchema.safeParse(message)
      if (parsed.success) resolve(parsed.data)
      else reject(parsed.error)
    })
    worker.once('error', reject)
  })
}

async function raceStoreOperations(
  path: string,
  operations: readonly {
    readonly action: string;
    readonly bundleId: string
  }[],
) {
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const workers = operations.map((operation) => {
    const worker = new Worker(new URL('../../__fixtures__/review-store-worker.mjs', import.meta.url), {
      workerData: {
        path,
        barrier,
        action: operation.action,
        request: {
          ...request,
          bundleId: operation.bundleId,
        },
        provenance,
        at,
      },
    })
    const ready = new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve())
      worker.once('error', reject)
    })
    const result = ready.then(() => readWorkerResult(worker))
    const exited = new Promise<void>((resolve, reject) => {
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code === 0) resolve()
        else reject(new TypeError(`SQLite fixture worker exited with code ${String(code)}.`))
      })
    })
    return {
      ready,
      result,
      exited,
    }
  })
  await Promise.all(workers.map((worker) => worker.ready))
  Atomics.store(new Int32Array(barrier), 0, 1)
  Atomics.notify(new Int32Array(barrier), 0)
  const results = await Promise.all(workers.map((worker) => worker.result))
  await Promise.all(workers.map((worker) => worker.exited))
  return results
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

describe('SQLite review transaction concurrency', () => {
  it('allows only one concurrent claim across independent database connections', async () => {
    const fixture = databasePath()
    try {
      const results = await raceStoreOperations(fixture.path, [
        {
          action: 'claim',
          bundleId: 'first'
        },
        {
          action: 'claim',
          bundleId: 'second'
        },
      ])
      expect(results.filter((result) => result.type === 'accepted')).toHaveLength(1)
      expect(results.filter((result) => result.type === 'rejected')).toMatchObject([
        { reason: expect.stringContaining('UNIQUE constraint failed') },
      ])
      expect(fixture.store.readEvents('workflow')).toHaveLength(2)
    } finally {
      fixture.store.db.close()
    }
  })

  it('rejects a concurrent duplicate completion without duplicate reviews or events', async () => {
    const fixture = databasePath()
    try {
      startBundle(fixture.store)
      const results = await raceStoreOperations(fixture.path, [
        {
          action: 'complete',
          bundleId: 'bundle'
        },
        {
          action: 'complete',
          bundleId: 'bundle'
        },
      ])
      expect(results.filter((result) => result.type === 'accepted')).toHaveLength(1)
      expect(results.filter((result) => result.type === 'rejected')).toMatchObject([
        { reason: expect.stringContaining('agent is completed') },
      ])
      expect(fixture.store.listSessionReviews('workflow')).toHaveLength(1)
      expect(fixture.store.readEvents('workflow')).toHaveLength(6)
    } finally {
      fixture.store.db.close()
    }
  })

  it('never rewrites cancellation when it races with completion', async () => {
    const fixture = databasePath()
    try {
      startBundle(fixture.store)
      await raceStoreOperations(fixture.path, [
        {
          action: 'complete',
          bundleId: 'bundle'
        },
        {
          action: 'cancel',
          bundleId: 'bundle'
        },
      ])
      expect(fixture.store.getReviewBundle('bundle')?.status).toBe('cancelled')
      const later = await raceStoreOperations(fixture.path, [{
        action: 'complete',
        bundleId: 'bundle'
      }])
      expect(later).toMatchObject([{
        type: 'rejected',
        reason: expect.stringContaining('bundle is cancelled')
      }])
      expect(fixture.store.listSessionReviews('workflow').length).toBeLessThanOrEqual(1)
    } finally {
      fixture.store.db.close()
    }
  })

  it('rolls back review insertion, agent completion, and events together on an event write failure', () => {
    const fixture = databasePath()
    try {
      startBundle(fixture.store)
      fixture.store.db.exec(`
        CREATE TRIGGER reject_completion BEFORE INSERT ON events
        WHEN NEW.type = 'review-agent-completed'
        BEGIN SELECT RAISE(ABORT, 'completion event rejected'); END;
      `)
      expect(() => fixture.store.completeReviewAgent('bundle', 'custom-review', provenance, at, {
        reviewType: 'custom-review',
        verdict: 'PASS',
        findings: [],
      }, 'REVIEWING')).toThrow('completion event rejected')
      expect(fixture.store.listSessionReviews('workflow')).toStrictEqual([])
      expect(fixture.store.listReviewAgents('bundle')[0]?.status).toBe('running')
      expect(fixture.store.readEvents('workflow')).toHaveLength(4)
    } finally {
      fixture.store.db.close()
    }
  })
})
