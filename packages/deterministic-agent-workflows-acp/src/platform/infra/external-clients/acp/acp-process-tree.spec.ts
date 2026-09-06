import {
  mkdtempSync, readFileSync, rmSync, writeFileSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  dirname, join 
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  afterEach, expect, it, vi 
} from 'vitest'
import { createAcpReviewAgentClient } from './acp-review-agent-client'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const logs: string[] = []
const request = {
  bundleId: 'tree-bundle',
  reviewType: 'tree-review',
  repository: 'owner/repository',
  workingDirectory: packageRoot,
  pullRequestNumber: 42,
  baseRevision: 'base',
  headRevision: 'head',
  prompt: 'Review the fixture.',
}
function pids(log: string): readonly number[] {
  return [...new Set(readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => Number(line.split(' ')[0])))]
}
function fixture(mode: string) {
  const log = join(mkdtempSync(join(tmpdir(), 'acp-process-tree-')), 'tree.log')
  writeFileSync(log, '')
  logs.push(log)
  return {
    log,
    client: createAcpReviewAgentClient({
      command: process.execPath,
      args: [join(packageRoot, 'src', '__fixtures__', 'fake-acp-process-tree.mjs')],
      environment: {
        FAKE_ACP_MODE: mode,
        FAKE_ACP_LOG: log 
      },
      timeoutMs: 2_000,
      cancellationGraceMs: 200,
    }),
  }
}
function cleanUpPid(pid: number): void {
  try { process.kill(pid, 'SIGKILL') } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}
afterEach(() => {
  for (const log of logs.splice(0)) {
    pids(log).forEach(cleanUpPid)
    rmSync(dirname(log), {
      recursive: true,
      force: true 
    })
  }
})
it('cancels both the agent and its SIGTERM-resistant descendant', async () => {
  const {
    client, log 
  } = fixture('slow')
  const run = await client.start(request)
  const completion = expect(run.completion).rejects.toThrow('ACP prompt was cancelled.')
  await run.cancel()
  await completion
  expect(pids(log)).toHaveLength(2)
  await vi.waitFor(() => {
    for (const pid of pids(log)) expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  })
})
it('cleans up descendants after successful completion', async () => {
  const {
    client, log 
  } = fixture('pass')
  const run = await client.start(request)
  await expect(run.completion).resolves.toMatchObject({ verdict: 'PASS' })
  await vi.waitFor(() => {
    for (const pid of pids(log)) expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  })
})
it('cleans up descendants when the parent exits before initialization', async () => {
  const {
    client, log 
  } = fixture('early-exit')
  await expect(client.start(request)).rejects.toThrow('exited before protocol completion')
  expect(pids(log)).toHaveLength(2)
  await vi.waitFor(() => {
    for (const pid of pids(log)) expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  })
})
it('cleans up descendants after a protocol rejection', async () => {
  const {
    client, log 
  } = fixture('wrong-version')
  await expect(client.start(request)).rejects.toThrow('Unsupported ACP protocol version')
  await vi.waitFor(() => {
    for (const pid of pids(log)) expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  })
})
it('cleans up descendants after a prompt timeout', async () => {
  const {
    client, log 
  } = fixture('ignore-cancel')
  const run = await client.start(request)
  await expect(run.completion).rejects.toMatchObject({ message: 'ACP prompt timed out after 2000ms.' })
  await vi.waitFor(() => {
    for (const pid of pids(log)) expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  })
})

it('does not terminate a different reviewer process group', async () => {
  const first = fixture('slow')
  const second = fixture('slow')
  const firstRun = await first.client.start(request)
  const firstCompletion = expect(firstRun.completion).rejects.toThrow('ACP prompt was cancelled.')
  const secondRun = await second.client.start(request)
  const secondCompletion = expect(secondRun.completion).rejects.toThrow('ACP prompt was cancelled.')
  try {
    await firstRun.cancel()
    await firstCompletion
    for (const pid of pids(second.log)) expect(process.kill(pid, 0)).toBe(true)
  } finally {
    await secondRun.cancel()
    await secondCompletion
  }
})
