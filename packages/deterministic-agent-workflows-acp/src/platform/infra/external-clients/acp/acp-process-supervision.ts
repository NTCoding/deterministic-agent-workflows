import type { ChildProcessWithoutNullStreams } from 'node:child_process'

/** @riviere-role external-client-error */
export class AcpTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpTimeoutError'
  }
}

/** @riviere-role external-client-service */
export function createAcpTimeout<T>(milliseconds: number, message: string): {
  readonly promise: Promise<T>
  readonly clear: () => void
} {
  const state: { timeout?: NodeJS.Timeout } = {}
  const promise = new Promise<T>((_resolve, reject) => {
    state.timeout = setTimeout(() => reject(new AcpTimeoutError(message)), milliseconds)
  })
  return {
    promise,
    clear: () => {
      if (state.timeout !== undefined) clearTimeout(state.timeout)
    },
  }
}

const stoppingProcesses = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>()

/** @riviere-role external-client-service */
export function stopAcpProcess(
  active: {
    readonly child: ChildProcessWithoutNullStreams
    readonly connection: { close(): void }
  },
  graceMs: number,
): Promise<void> {
  const existing = stoppingProcesses.get(active.child)
  if (existing !== undefined) return existing
  const stopping = terminateAcpProcess(active.child, graceMs).finally(() => {
    active.connection.close()
  })
  stoppingProcesses.set(active.child, stopping)
  return stopping
}

async function terminateAcpProcess(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  child.kill('SIGTERM')
  const grace = createAcpTimeout<void>(graceMs, 'ACP process did not stop after SIGTERM.')
  try {
    await Promise.race([exited, grace.promise])
  } catch (error) {
    if (!(error instanceof AcpTimeoutError)) throw error
    child.kill('SIGKILL')
    await exited
  } finally {
    grace.clear()
  }
}

/** @riviere-role external-client-service */
export async function cancelAcpSession(input: {
  readonly notify: () => Promise<void>
  readonly processFailure: Promise<never>
  readonly prompt: Promise<unknown>
  readonly stop: () => Promise<void>
  readonly graceMs: number
}): Promise<void> {
  const notificationTimeout = createAcpTimeout<never>(
    input.graceMs,
    'ACP cancellation notification timed out.',
  )
  try {
    await Promise.race([input.notify(), input.processFailure, notificationTimeout.promise])
    notificationTimeout.clear()
    const grace = createAcpTimeout<never>(input.graceMs, 'ACP cooperative cancellation timed out.')
    try {
      await Promise.race([input.prompt.then(() => undefined, () => undefined), grace.promise])
    } catch (error) {
      if (!(error instanceof AcpTimeoutError)) throw error
    } finally {
      grace.clear()
    }
  } finally {
    notificationTimeout.clear()
    await input.stop()
  }
}
