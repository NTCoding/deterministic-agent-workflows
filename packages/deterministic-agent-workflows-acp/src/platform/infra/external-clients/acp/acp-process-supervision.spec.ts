import {
  describe, expect, it, vi
} from 'vitest'
import {
  AcpTimeoutError, cancelAcpSession, cancelTimedOutAcpPrompt
} from './acp-process-supervision'

const pending = new Promise<never>(() => undefined)

describe('ACP cancellation supervision', () => {
  it('preserves the original timeout when cancellation succeeds', async () => {
    const timeout = new AcpTimeoutError('ACP prompt timed out.')
    await expect(cancelTimedOutAcpPrompt(timeout, async () => undefined)).rejects.toBe(timeout)
  })

  it.each(['notification failed', 'transport failed', 'cleanup failed'])(
    'preserves both the prompt timeout and %s', async (reason) => {
      const timeout = new AcpTimeoutError('ACP prompt timed out.')
      const cancellation = new TypeError(reason)
      await expect(cancelTimedOutAcpPrompt(timeout, async () => { throw cancellation })).rejects.toMatchObject({
        name: 'AcpTimeoutError',
        message: `ACP prompt timed out. Cancellation failed: TypeError: ${reason}`,
        cause: {
          timeout,
          cancellation
        },
      })
    },
  )

  it('waits for cooperative prompt completion before stopping the process', async () => {
    const state: { complete?: () => void } = {}
    const prompt = new Promise<void>((resolve) => {
      state.complete = resolve
    })
    const notify = vi.fn(async () => undefined)
    const stop = vi.fn(async () => undefined)
    const cancellation = cancelAcpSession({
      notify,
      processFailure: pending,
      prompt,
      stop,
      graceMs: 1_000,
    })
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce())
    expect(stop).not.toHaveBeenCalled()
    state.complete?.()
    await cancellation
    expect(stop).toHaveBeenCalledOnce()
  })

  it('cleans up and rejects when the cancellation notification fails', async () => {
    const stop = vi.fn(async () => undefined)
    await expect(cancelAcpSession({
      notify: async () => { throw new TypeError('notification failed') },
      processFailure: pending,
      prompt: pending,
      stop,
      graceMs: 50,
    })).rejects.toThrow('notification failed')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('cleans up when the connection fails during a stalled notification', async () => {
    const stop = vi.fn(async () => undefined)
    await expect(cancelAcpSession({
      notify: () => pending,
      processFailure: Promise.reject(new TypeError('transport disconnected')),
      prompt: pending,
      stop,
      graceMs: 50,
    })).rejects.toThrow('transport disconnected')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('bounds stalled cancellation notifications and still stops the process', async () => {
    const stop = vi.fn(async () => undefined)
    await expect(cancelAcpSession({
      notify: () => pending,
      processFailure: pending,
      prompt: pending,
      stop,
      graceMs: 10,
    })).rejects.toThrow('ACP cancellation notification timed out.')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('escalates after the cooperative grace period for a stalled prompt', async () => {
    const stop = vi.fn(async () => undefined)
    await expect(cancelAcpSession({
      notify: async () => undefined,
      processFailure: pending,
      prompt: pending,
      stop,
      graceMs: 10,
    })).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledOnce()
  })
})
