import { setTimeout as delay } from 'node:timers/promises'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

/** @riviere-role external-client-error */
export class AcpTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
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

/** @riviere-role external-client-service */
export async function cancelTimedOutAcpPrompt(
  timeout: AcpTimeoutError,
  cancel: () => Promise<void>,
): Promise<never> {
  try {
    await cancel()
  } catch (cancellation: unknown) {
    throw new AcpTimeoutError(
      `${timeout.message} Cancellation failed: ${String(cancellation)}`,
      {
        cause: {
          timeout,
          cancellation
        }
      },
    )
  }
  throw timeout
}

const stoppingProcesses = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>()

/** @riviere-role external-client-service */
export function stopAcpProcess(
  active: {
    readonly child: ChildProcessWithoutNullStreams
    readonly connection: { close(): void }
  },
  graceMs: number,
  terminationTimeoutMs: number,
): Promise<void> {
  const existing = stoppingProcesses.get(active.child)
  if (existing !== undefined) return existing
  const stopping = terminateAcpProcess(active.child, graceMs, terminationTimeoutMs).finally(() => {
    active.connection.close()
  })
  stoppingProcesses.set(active.child, stopping)
  return stopping
}

/** @riviere-role external-client-error */
class AcpUnsupportedPlatformError extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`ACP process-tree supervision requires macOS or Linux; unsupported host: ${platform}.`)
    this.name = 'AcpUnsupportedPlatformError'
  }
}

/** @riviere-role external-client-service */
export function requireAcpProcessGroups(platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new AcpUnsupportedPlatformError(platform)
  }
}

/** @riviere-role external-client-error */
class AcpProcessGroupError extends Error {
  constructor(pid: number) {
    super(`Invalid ACP process group identifier: ${String(pid)}.`)
    this.name = 'AcpProcessGroupError'
  }
}

/** @riviere-role external-client-service */
export function signalAcpProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new AcpProcessGroupError(pid)
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ESRCH') return false
      // EPERM on a zero-signal existence probe means present, never successfully stopped.
      if (signal === 0 && error.code === 'EPERM') return true
    }
    throw error
  }
}

async function waitForProcessGroupExit(pid: number, graceMs: number): Promise<void> {
  const deadline = performance.now() + graceMs
  while (signalAcpProcessGroup(pid, 0)) {
    if (performance.now() >= deadline) {
      throw new AcpTimeoutError(`ACP process group ${String(pid)} did not stop within ${String(graceMs)}ms.`)
    }
    await delay(10)
  }
}

async function terminateAcpProcess(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
  terminationTimeoutMs: number,
): Promise<void> {
  if (child.pid === undefined) return
  const exited = child.stdout.closed && child.stderr.closed
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once('close', () => resolve()))
  await terminateAcpProcessGroup(child.pid, graceMs, terminationTimeoutMs)
  const timeout = createAcpTimeout<void>(terminationTimeoutMs, 'ACP process streams did not close after termination.')
  try {
    await Promise.race([exited, timeout.promise])
  } finally {
    timeout.clear()
  }
}

async function terminateAcpProcessGroup(pid: number, graceMs: number, terminationTimeoutMs: number): Promise<void> {
  // The group can outlive its leader. An exited child is not evidence of cleanup.
  if (!signalAcpProcessGroup(pid, 'SIGTERM')) return
  try {
    await waitForProcessGroupExit(pid, graceMs)
  } catch (error) {
    if (!(error instanceof AcpTimeoutError)) throw error
    signalAcpProcessGroup(pid, 'SIGKILL')
    await waitForProcessGroupExit(pid, terminationTimeoutMs)
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
