import {
  spawn, type ChildProcessWithoutNullStreams 
} from 'node:child_process'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ClientContext,
} from '@agentclientprotocol/sdk'
import type { FreshContextLauncher } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { buildProcessEnvironment } from './acp-review-agent-client'
import {
  cancelAcpSession,
  createAcpTimeout,
  requireAcpProcessGroups,
  stopAcpProcess,
} from './acp-process-supervision'

class AcpFreshAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpFreshAgentError'
  }
}

/** @riviere-role external-client-model */
export interface AcpFreshAgentRuntimeConfig {
  readonly command: string
  readonly args?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly cancellationGraceMs: number
}

/** @riviere-role external-client-model */
export interface AcpFreshAgentRun {
  readonly providerSessionId: string
  readonly settled: Promise<'end_turn' | 'cancelled'>
  readonly cancel: () => Promise<void>
}

type ActiveFreshAgent = {
  readonly child: ChildProcessWithoutNullStreams
  readonly connection: ClientConnection
  readonly context: ClientContext
  readonly processFailure: Promise<never>
}

async function openFreshAgentProcess(
  config: AcpFreshAgentRuntimeConfig,
  workingDirectory: string,
): Promise<ActiveFreshAgent> {
  const child = spawn(config.command, [...(config.args ?? [])], {
    cwd: workingDirectory,
    env: buildProcessEnvironment(config.environment),
    shell: false,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const processFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => reject(new AcpFreshAgentError(`ACP fresh agent process failed: ${String(error)}`)))
    child.once('exit', (code, signal) => reject(new AcpFreshAgentError(
      `ACP fresh agent process exited (code ${String(code)}, signal ${String(signal)}).`,
    )))
  })
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        child.stdin.write(chunk, (error) => error === null ? resolve() : reject(error))
      })
    },
  })
  const readableState = { closed: false }
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on('data', (chunk: Uint8Array) => {
        if (!readableState.closed) controller.enqueue(chunk)
      })
      child.stdout.on('end', () => {
        if (readableState.closed) return
        readableState.closed = true
        controller.close()
      })
      child.stdout.on('error', (error) => {
        if (readableState.closed) return
        readableState.closed = true
        controller.error(error)
      })
    },
    cancel() {
      readableState.closed = true
      child.stdout.destroy()
    },
  })
  const app = client({ name: 'deterministic-agent-workflow' })
  const stream = ndJsonStream(output, input)
  const connection = app.connect(stream)
  const context = connection.agent
  return {
    child,
    connection,
    context,
    processFailure,
  }
}

/** @riviere-role external-client-service */
export function createAcpFreshAgentRuntime(config: AcpFreshAgentRuntimeConfig): FreshContextLauncher & {readonly lastRun: () => AcpFreshAgentRun | undefined} {
  requireAcpProcessGroups()
  if (config.command.trim().length === 0) {
    throw new AcpFreshAgentError('ACP fresh agent command must not be empty.')
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new AcpFreshAgentError('ACP fresh agent timeoutMs must be a positive safe integer.')
  }
  if (!Number.isSafeInteger(config.cancellationGraceMs) || config.cancellationGraceMs <= 0) {
    throw new AcpFreshAgentError('ACP fresh agent cancellationGraceMs must be a positive safe integer.')
  }
  const runtime: { currentRun?: AcpFreshAgentRun } = {}

  async function openSessionOn(spawned: ActiveFreshAgent, workingDirectory: string): Promise<string> {
    const initializationTimeout = createAcpTimeout<never>(
      config.timeoutMs,
      `ACP fresh agent initialization timed out after ${String(config.timeoutMs)}ms.`,
    )
    try {
      const initialization = await Promise.race([
        spawned.context.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: 'deterministic-agent-workflow',
            version: '0.1.0',
          },
        }),
        spawned.processFailure,
        initializationTimeout.promise,
      ])
      if (initialization.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpFreshAgentError(
          `Unsupported ACP protocol version ${String(initialization.protocolVersion)}; expected ${String(PROTOCOL_VERSION)}.`,
        )
      }
      const session = await Promise.race([
        spawned.context.request(methods.agent.session.new, {
          cwd: workingDirectory,
          mcpServers: [],
        }),
        spawned.processFailure,
        initializationTimeout.promise,
      ])
      return session.sessionId
    } catch (error) {
      await stopAcpProcess(spawned, config.cancellationGraceMs, config.timeoutMs).catch(() => undefined)
      throw error
    } finally {
      initializationTimeout.clear()
    }
  }

  async function start(launch: {
    readonly workflowSessionId: string
    readonly stateInstructions: string
  }): Promise<void> {
    const workingDirectory = process.cwd()
    const spawned = await openFreshAgentProcess(config, workingDirectory)
    const sessionId = await openSessionOn(spawned, workingDirectory)
    const prompt = spawned.context.request(methods.agent.session.prompt, {
      sessionId,
      prompt: [{
        type: 'text',
        text: launch.stateInstructions
      }],
    })
    const cancelled = { value: false }
    const settled = new Promise<'end_turn' | 'cancelled'>((resolve, reject) => {
      prompt.then(
        (response: { readonly stopReason: string }) => resolve(response.stopReason === 'cancelled' ? 'cancelled' : 'end_turn'),
        (error: unknown) => cancelled.value
          ? resolve('cancelled')
          : reject(new AcpFreshAgentError(`ACP fresh agent prompt failed: ${String(error)}`)),
      )
      spawned.processFailure.catch((error: unknown) => {
        if (cancelled.value) {
          resolve('cancelled')
          return
        }
        reject(error)
      })
    })
    const run: AcpFreshAgentRun = {
      providerSessionId: sessionId,
      settled,
      cancel: async () => {
        cancelled.value = true
        await cancelAcpSession({
          notify: () => spawned.context.notify(methods.agent.session.cancel, { sessionId }),
          processFailure: spawned.processFailure,
          prompt,
          stop: () => stopAcpProcess(spawned, config.cancellationGraceMs, config.timeoutMs),
          graceMs: config.cancellationGraceMs,
        })
      },
    }
    runtime.currentRun = run
    void settled.finally(() => {
      void stopAcpProcess(spawned, config.cancellationGraceMs, config.timeoutMs).catch(() => undefined)
      if (runtime.currentRun === run) runtime.currentRun = undefined
    })
  }

  return {
    start,
    lastRun: () => runtime.currentRun,
  }
}
