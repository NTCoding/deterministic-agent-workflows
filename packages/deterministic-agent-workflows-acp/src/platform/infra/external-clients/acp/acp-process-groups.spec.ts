import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  afterEach, expect, it, vi 
} from 'vitest'
import {
  requireAcpProcessGroups, signalAcpProcessGroup, stopAcpProcess 
} from './acp-process-supervision'

afterEach(() => vi.restoreAllMocks())

it.each(['darwin', 'linux'] as const)('accepts supported process-group hosts: %s', (platform) => {
  expect(() => requireAcpProcessGroups(platform)).not.toThrow()
})
it('rejects Windows before ACP launch', () => {
  expect(() => requireAcpProcessGroups('win32')).toThrow('unsupported host: win32')
})
it.each([0, 1, -1, NaN, 1.5])('rejects unsafe group identifiers: %s', (pid) => {
  const kill = vi.spyOn(process, 'kill')
  expect(() => signalAcpProcessGroup(pid, 'SIGTERM')).toThrow('Invalid ACP process group identifier')
  expect(kill).not.toHaveBeenCalled()
})
it('signals the negative group identifier, not only the leader', () => {
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  expect(signalAcpProcessGroup(1234, 'SIGTERM')).toBe(true)
  expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM')
})
it('accepts an already absent group', () => {
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new TypeError('gone'), { code: 'ESRCH' }) })
  expect(signalAcpProcessGroup(1234, 0)).toBe(false)
})
it.each([Object.assign(new TypeError('denied'), { code: 'EPERM' }), new TypeError('unknown failure'), 'transport failure'])('preserves signalling failures: %s', (failure) => {
  vi.spyOn(process, 'kill').mockImplementation(() => { throw failure })
  expect(() => signalAcpProcessGroup(1234, 'SIGTERM')).toThrow(failure instanceof Error ? failure.message : failure)
})
it('bounds failed forced termination and closes the protocol connection', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'pipe' 
  })
  const closed = once(child, 'close')
  await once(child, 'spawn')
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  const connection = { close: vi.fn() }
  try {
    const first = stopAcpProcess({
      child,
      connection 
    }, 20)
    expect(stopAcpProcess({
      child,
      connection 
    }, 20)).toBe(first)
    await expect(first).rejects.toThrow('did not stop within 20ms')
    expect(kill).toHaveBeenCalledWith(-Number(child.pid), 'SIGKILL')
    expect(connection.close).toHaveBeenCalledOnce()
  } finally {
    kill.mockRestore()
    child.kill('SIGKILL')
    await closed
  }
})

it('treats a permission-denied existence probe as present, not successfully stopped', () => {
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new TypeError('denied'), { code: 'EPERM' }) })
  expect(signalAcpProcessGroup(1234, 0)).toBe(true)
  expect(() => signalAcpProcessGroup(1234, 'SIGKILL')).toThrow('denied')
})
