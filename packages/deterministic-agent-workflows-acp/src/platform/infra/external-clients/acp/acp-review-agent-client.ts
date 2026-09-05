import {
  spawn, type ChildProcessWithoutNullStreams
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ClientContext,
  type InitializeResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import {
  reviewPayloadSchema,
  type ReviewPayload,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type {
  ReviewAgentClient,
  ReviewAgentRequest,
  ReviewAgentRun,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import type { AcpReviewAgentClientConfig } from '../../../domain/acp-review-agent-client-types'

class AcpProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpProtocolError'
  }
}

const inheritedEnvironmentKeys = ['HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TMPDIR'] as const
const forbiddenCredentialName = /^(?:GH_TOKEN|GH_[A-Z0-9_]+|GITHUB_TOKEN|GITHUB_[A-Z0-9_]+|GIT_ASKPASS)$/u

type ActiveProcess = {
  readonly child: ChildProcessWithoutNullStreams
  readonly connection: ClientConnection
  readonly context: ClientContext
  readonly outputBySession: Map<string, string>
  readonly stderr: () => string
  readonly capabilities: InitializeResponse['agentCapabilities']
  readonly processFailure: Promise<never>
}

function createTimeout<T>(milliseconds: number, message: string): {
  readonly promise: Promise<T>
  readonly clear: () => void
} {
  const state: { timeout?: NodeJS.Timeout } = {}
  const promise = new Promise<T>((_resolve, reject) => {
    state.timeout = setTimeout(
      () => reject(new AcpProtocolError(message)),
      milliseconds,
    )
  })
  return {
    promise,
    clear: () => {
      if (state.timeout !== undefined) clearTimeout(state.timeout)
    },
  }
}

function appendAgentText(
  outputBySession: Map<string, string>,
  notification: SessionNotification,
): void {
  if (notification.update.sessionUpdate !== 'agent_message_chunk') return
  if (notification.update.content.type !== 'text') return
  const current = outputBySession.get(notification.sessionId)
  outputBySession.set(
    notification.sessionId,
    current === undefined ? notification.update.content.text : current + notification.update.content.text,
  )
}

function buildProcessEnvironment(
  configured: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of inheritedEnvironmentKeys) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  for (const [key, value] of Object.entries(configured ?? {})) {
    if (forbiddenCredentialName.test(key)) {
      throw new AcpProtocolError(`ACP reviewer environment must not include credential ${key}.`)
    }
    environment[key] = value
  }
  return environment
}

async function openProcess(
  config: AcpReviewAgentClientConfig,
  workingDirectory: string,
): Promise<ActiveProcess> {
  const child = spawn(config.command, [...(config.args ?? [])], {
    cwd: workingDirectory,
    env: buildProcessEnvironment(config.environment),
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stderrChunks: string[] = []
  const processExit = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null
  }>(
    (resolve) => child.once('exit', (code, signal) => resolve({
      code,
      signal
    })),
  )
  const processFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => reject(
      new AcpProtocolError(`ACP process failed: ${String(error)}`),
    ))
    child.once('exit', (code, signal) => reject(new AcpProtocolError(
      `ACP process exited before protocol completion (code ${String(code)}, signal ${String(signal)}). stderr: ${stderrChunks.join('').trim()}`,
    )))
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrChunks.push(chunk)
  })
  const outputBySession = new Map<string, string>()
  const app = client({ name: 'deterministic-agent-workflow' })
    .onNotification(methods.client.session.update, (notification) => {
      appendAgentText(outputBySession, notification.params)
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
  const stream = ndJsonStream(output, input)
  const connection = app.connect(stream)
  const context = connection.agent
  const initializationTimeout = createTimeout<never>(
    config.timeoutMs,
    `ACP initialization timed out after ${String(config.timeoutMs)}ms.`,
  )
  try {
    const initialization = await Promise.race([
      context.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: {
          name: 'deterministic-agent-workflow',
          version: '0.1.0',
        },
      }),
      processFailure,
      initializationTimeout.promise,
    ])
    if (initialization.protocolVersion !== PROTOCOL_VERSION) {
      throw new AcpProtocolError(
        `Unsupported ACP protocol version ${String(initialization.protocolVersion)}; expected ${String(PROTOCOL_VERSION)}.`,
      )
    }
    return {
      child,
      connection,
      context,
      outputBySession,
      stderr: () => stderrChunks.join(''),
      capabilities: initialization.agentCapabilities,
      processFailure,
    }
  } catch (error) {
    const exit = await Promise.race([
      processExit,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 25)),
    ])
    await stopProcess({
      child,
      connection
    }, config.cancellationGraceMs)
    if (exit !== undefined) {
      throw new AcpProtocolError(
        `ACP process exited before protocol completion (code ${String(exit.code)}, signal ${String(exit.signal)}). stderr: ${stderrChunks.join('').trim()}`,
      )
    }
    throw error
  } finally {
    initializationTimeout.clear()
  }
}

async function stopProcess(
  active: Pick<ActiveProcess, 'child' | 'connection'>,
  graceMs: number,
): Promise<void> {
  const closeError: unknown = (() => {
    try {
      active.connection.close()
      return undefined
    } catch (error) {
      return error
    }
  })()
  if (active.child.exitCode === null && active.child.signalCode === null) {
    const exited = new Promise<void>((resolve) => {
      active.child.once('close', () => resolve())
    })
    active.child.kill('SIGTERM')
    const grace = createTimeout<void>(graceMs, 'ACP process did not stop after SIGTERM.')
    try {
      await Promise.race([exited, grace.promise])
    } catch {
      active.child.kill('SIGKILL')
      await exited
    } finally {
      grace.clear()
    }
  }
  if (closeError !== undefined) throw closeError
}

function promptCompletion(
  active: ActiveProcess,
  sessionId: string,
  prompt: string,
  config: AcpReviewAgentClientConfig,
): Promise<ReviewPayload> {
  return (async () => {
    const timeout = createTimeout<never>(
      config.timeoutMs,
      `ACP prompt timed out after ${String(config.timeoutMs)}ms.`,
    )
    try {
      const response = await Promise.race([
        active.context.request(methods.agent.session.prompt, {
          sessionId,
          prompt: [{
            type: 'text',
            text: prompt
          }],
        }),
        timeout.promise,
        active.processFailure,
      ])
      if (response.stopReason === 'cancelled') {
        throw new AcpProtocolError('ACP prompt was cancelled.')
      }
      const output = active.outputBySession.get(sessionId)?.trim()
      if (output === undefined || output.length === 0) {
        const stderr = active.stderr().trim()
        throw new AcpProtocolError(
          stderr.length === 0 ? 'ACP agent returned no review output.' : `ACP agent returned no review output. stderr: ${stderr}`,
        )
      }
      return reviewPayloadSchema.parse(JSON.parse(output))
    } finally {
      timeout.clear()
      await stopProcess(active, config.cancellationGraceMs)
    }
  })()
}

function createRun(
  active: ActiveProcess,
  sessionId: string,
  input: ReviewAgentRequest,
  config: AcpReviewAgentClientConfig,
): ReviewAgentRun {
  return {
    providerSessionId: sessionId,
    providerRunId: randomUUID(),
    completion: promptCompletion(active, sessionId, input.prompt, config),
    async cancel(): Promise<void> {
      try {
        await Promise.race([
          active.context.notify(methods.agent.session.cancel, { sessionId }),
          active.processFailure,
        ])
      } finally {
        await stopProcess(active, config.cancellationGraceMs)
      }
    },
  }
}

async function openSession(
  active: ActiveProcess,
  input: ReviewAgentRequest,
  loadSessionId: string | undefined,
  config: AcpReviewAgentClientConfig,
): Promise<string> {
  const mcpServers = [...(config.mcpServers ?? [])]
  const timeout = createTimeout<never>(
    config.timeoutMs,
    `ACP session open timed out after ${String(config.timeoutMs)}ms.`,
  )
  try {
    if (loadSessionId === undefined) {
      const session = await Promise.race([
        active.context.request(methods.agent.session.new, {
          cwd: input.workingDirectory,
          mcpServers,
        }),
        active.processFailure,
        timeout.promise,
      ])
      return session.sessionId
    }
    if (active.capabilities?.loadSession !== true) {
      throw new AcpProtocolError('ACP agent does not advertise session/load support.')
    }
    await Promise.race([
      active.context.request(methods.agent.session.load, {
        cwd: input.workingDirectory,
        mcpServers,
        sessionId: loadSessionId,
      }),
      active.processFailure,
      timeout.promise,
    ])
    return loadSessionId
  } catch (error) {
    await stopProcess(active, config.cancellationGraceMs)
    throw error
  } finally {
    timeout.clear()
  }
}

/** @riviere-role external-client-service */
export function createAcpReviewAgentClient(
  config: AcpReviewAgentClientConfig,
): ReviewAgentClient {
  if (config.command.trim().length === 0) {
    throw new AcpProtocolError('ACP reviewer command must not be empty.')
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new AcpProtocolError('ACP reviewer timeoutMs must be a positive safe integer.')
  }
  if (!Number.isSafeInteger(config.cancellationGraceMs) || config.cancellationGraceMs <= 0) {
    throw new AcpProtocolError(
      'ACP reviewer cancellationGraceMs must be a positive safe integer.',
    )
  }
  const activeBySession = new Map<string, ActiveProcess>()

  async function startSession(
    input: ReviewAgentRequest,
    loadSessionId?: string,
  ): Promise<ReviewAgentRun> {
    const active = await openProcess(config, input.workingDirectory)
    const sessionId = await openSession(active, input, loadSessionId, config)
    if (activeBySession.has(sessionId)) {
      await stopProcess(active, config.cancellationGraceMs)
      throw new AcpProtocolError(`ACP provider session ${sessionId} is already active.`)
    }
    activeBySession.set(sessionId, active)
    const run = createRun(active, sessionId, input, config)
    void run.completion.then(
      () => activeBySession.delete(sessionId),
      () => activeBySession.delete(sessionId),
    )
    return run
  }

  return {
    start: (input) => startSession(input),
    load: (input, providerSessionId) => startSession(input, providerSessionId),
    async cancel(providerSessionId: string): Promise<void> {
      const active = activeBySession.get(providerSessionId)
      if (active === undefined) return
      try {
        await Promise.race([
          active.context.notify(methods.agent.session.cancel, { sessionId: providerSessionId }),
          active.processFailure,
        ])
      } finally {
        try {
          await stopProcess(active, config.cancellationGraceMs)
        } finally {
          activeBySession.delete(providerSessionId)
        }
      }
    },
  }
}
