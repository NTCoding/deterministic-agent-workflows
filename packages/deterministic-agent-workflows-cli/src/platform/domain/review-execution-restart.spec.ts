import { spawn } from 'node:child_process'
import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect, it, vi
} from 'vitest'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type { ReviewPayload } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  ReviewCoordinator, type ReviewAgentClient
} from './review-coordinator'

it('excludes live process owners and recovers persisted sessions once an owner process exits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'review-restart-ownership-'))
  const database = join(directory, 'events.db')
  const store = createStore(database)
  const competitorStore = createStore(database)
  const request = {
    bundleId: 'bundle',
    sessionId: 'workflow',
    repository: 'owner/repository',
    workingDirectory: directory,
    pullRequestNumber: 42,
    baseRevision: 'base',
    headRevision: 'head',
    changedFiles: ['file.ts'],
    stateInstructions: 'Review the fixture.',
    reviews: ['one', 'two', 'three', 'four'].map(reviewType => ({
      reviewType,
      instructions: 'Inspect.',
      version: '1'
    })),
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../__fixtures__/review-execution-owner.mjs', import.meta.url)), database, JSON.stringify(request)], {stdio: 'pipe'})
  const closed = new Promise<void>(resolve => { child.once('close', () => resolve()) })
  const errors: string[] = []
  child.stderr.on('data', chunk => { errors.push(String(chunk)) })
  child.on('error', error => { errors.push(String(error)) })
  const completions: Array<(payload: ReviewPayload) => void> = []
  const client: ReviewAgentClient = {
    start: vi.fn(),
    load: vi.fn(async (_input, session) => ({
      providerSessionId: session,
      providerRunId: `resumed-${session}`,
      completion: new Promise<ReviewPayload>(resolve => completions.push(resolve)),
      cancel: async () => undefined
    })),
    cancel: vi.fn(),
  }
  const coordinator = new ReviewCoordinator({
    store,
    client,
    now: () => new Date().toISOString()
  })
  const competitor = new ReviewCoordinator({
    store: competitorStore,
    client,
    now: () => new Date().toISOString()
  })
  try {
    await vi.waitFor(() => {
      expect({
        exitCode: child.exitCode,
        signal: child.signalCode,
        statuses: store.listReviewAgents('bundle').map(agent => agent.status)
      }, errors.join('')).toStrictEqual({
        exitCode: null,
        signal: null,
        statuses: ['running', 'running', 'running', 'running']
      })
    }, {timeout: 5000})
    await expect(coordinator.run(request, 'REVIEWING')).rejects.toThrow('Unable to claim SQLite exclusive lock')
    const loadsBeforeRecovery = vi.mocked(client.load).mock.calls.length
    child.kill('SIGKILL')
    await closed
    const running = coordinator.run(request, 'REVIEWING')
    await expect(competitor.run(request, 'REVIEWING')).rejects.toThrow('Unable to claim SQLite exclusive lock')
    completions.forEach(resolve => resolve({
      verdict: 'PASS',
      findings: []
    }))
    expect({
      outcome: await running,
      loadsBeforeRecovery,
      loads: vi.mocked(client.load).mock.calls.length,
      starts: vi.mocked(client.start).mock.calls.length,
      reviewCount: store.listSessionReviews('workflow').length,
      resumedIdentities: store.listReviewAgents('bundle').every(agent =>
        agent.providerSessionId === `persisted-${agent.reviewType}` &&
        agent.providerRunId === `resumed-${agent.providerSessionId}`),
    }).toMatchObject({
      outcome: {type: 'completed'},
      loadsBeforeRecovery: 0,
      loads: 4,
      starts: 0,
      reviewCount: 4,
      resumedIdentities: true
    })
  } finally {
    child.kill('SIGKILL')
    await closed
    store.db.close(); competitorStore.db.close()
    rmSync(directory, {
      recursive: true,
      force: true
    })
  }
}, 10000)
