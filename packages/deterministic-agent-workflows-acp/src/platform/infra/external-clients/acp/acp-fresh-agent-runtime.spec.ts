import {
  mkdtempSync, readFileSync, rmSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  join, dirname 
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  afterEach, describe, expect, it, vi 
} from 'vitest'
import { createAcpFreshAgentRuntime } from './acp-fresh-agent-runtime'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../../../__fixtures__')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true 
    })
  }
})

function createLog(): {
  readonly path: string;
  readonly events: () => string[] 
} {
  const directory = mkdtempSync(join(tmpdir(), 'acp-fresh-agent-'))
  temporaryDirectories.push(directory)
  return {
    path: join(directory, 'events.log'),
    events: () => readFileSync(join(directory, 'events.log'), 'utf8').split('\n').filter((line) => line.length > 0),
  }
}

function createRuntime(mode: string, logPath?: string) {
  return createAcpFreshAgentRuntime({
    command: process.execPath,
    args: [join(fixtureDirectory, 'fake-acp-agent.mjs')],
    environment: {
      FAKE_ACP_MODE: mode,
      ...(logPath === undefined ? {} : { FAKE_ACP_LOG: logPath }) 
    },
    timeoutMs: 5_000,
    cancellationGraceMs: 250,
  })
}

describe('ACP fresh agent runtime', () => {
  it('rejects an empty command', () => {
    expect(() => createAcpFreshAgentRuntime({
      command: '  ',
      timeoutMs: 1_000,
      cancellationGraceMs: 250,
    })).toThrow('command must not be empty')
  })

  it('launches the fresh agent with the state instructions as its first prompt', async () => {
    const log = createLog()
    const runtime = createRuntime('pass', log.path)
    await runtime.start({
      workflowSessionId: 'session-1',
      stateInstructions: 'You are in ADDRESSING_FEEDBACK. Read the review threads.',
    })
    const run = runtime.lastRun()
    expect(run?.providerSessionId).toBe('fake-session')
    await vi.waitFor(() => {
      expect(log.events().some((event) => event.includes('"You are in ADDRESSING_FEEDBACK'))).toBe(true)
    })
    expect(await run?.settled).toBe('end_turn')
  })

  it('cancels a running fresh agent cooperatively and reports cancellation', async () => {
    const runtime = createRuntime('slow')
    await runtime.start({
      workflowSessionId: 'session-1',
      stateInstructions: 'Instructions',
    })
    const run = runtime.lastRun()
    await run?.cancel()
    expect(await run?.settled).toBe('cancelled')
  })

  it('fails closed when the fresh agent process exits before the prompt', async () => {
    const runtime = createRuntime('early-exit')
    await expect(runtime.start({
      workflowSessionId: 'session-1',
      stateInstructions: 'Instructions',
    })).rejects.toThrow(/exited|closed/u)
  })
})
