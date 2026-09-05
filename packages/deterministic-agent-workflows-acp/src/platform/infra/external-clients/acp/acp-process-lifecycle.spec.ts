import {
  mkdtempSync, readFileSync, rmSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  dirname, join
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  afterEach, describe, expect, it, vi
} from 'vitest'
import { createAcpReviewAgentClient } from './acp-review-agent-client'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const directories: string[] = []
const request = {
  bundleId: 'bundle',
  reviewType: 'custom-review',
  repository: 'owner/repository',
  workingDirectory: packageRoot,
  pullRequestNumber: 42,
  baseRevision: 'base',
  headRevision: 'head',
  prompt: 'Review the recorded change.',
}

function observedClient(mode: string) {
  const directory = mkdtempSync(join(tmpdir(), 'acp-lifecycle-'))
  directories.push(directory)
  const logPath = join(directory, 'process.log')
  writeFileSync(logPath, '')
  return {
    log: () => readFileSync(logPath, 'utf8'),
    client: createAcpReviewAgentClient({
      command: process.execPath,
      args: [join(packageRoot, 'src', '__fixtures__', 'fake-acp-agent.mjs')],
      environment: {
        FAKE_ACP_MODE: mode,
        FAKE_ACP_LOG: logPath,
      },
      timeoutMs: 5_000,
      cancellationGraceMs: 100,
    }),
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

describe('ACP process lifecycle', () => {
  it('runs four real fixture processes with overlapping prompts and cooperative cancellation', async () => {
    const observed = observedClient('slow')
    const runs = await Promise.all([1, 2, 3, 4].map(() => observed.client.start(request)))
    const completions = runs.map((run) => expect(run.completion).rejects.toThrow('ACP prompt was cancelled.'))
    await vi.waitFor(() => expect(observed.log().match(/prompt-started/gu)).toHaveLength(4))
    await Promise.all(runs.map((run) => run.cancel()))
    await Promise.all(completions)
    expect(observed.log().match(/prompt-cancelled/gu)).toHaveLength(4)
  })

  it('kills a process that ignores both cooperative cancellation and SIGTERM', async () => {
    const observed = observedClient('ignore-cancel')
    const run = await observed.client.start(request)
    const completion = expect(run.completion).rejects.toThrow(/ACP connection closed|signal SIGKILL/u)
    await vi.waitFor(() => expect(observed.log()).toContain('prompt-started'))
    await observed.client.cancel(run.providerSessionId, run.providerRunId)
    await completion
    expect(observed.log()).toMatch(/cancel-received\n\d+ SIGTERM\n/u)
    const pid = Number(observed.log().split(' ')[0])
    expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  })

  it('removes active run state after completion so repeated cancellation is harmless', async () => {
    const observed = observedClient('slow')
    const run = await observed.client.start(request)
    const completion = expect(run.completion).rejects.toThrow('ACP prompt was cancelled.')
    await vi.waitFor(() => expect(observed.log()).toContain('prompt-started'))
    await observed.client.cancel(run.providerSessionId, run.providerRunId)
    await completion
    await observed.client.cancel(run.providerSessionId, run.providerRunId)
    expect(observed.log().match(/cancel-received/gu)).toHaveLength(1)
  })
})
