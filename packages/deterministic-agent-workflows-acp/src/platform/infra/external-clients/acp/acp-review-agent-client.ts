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
  try {
    const initialization = await context.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: 'deterministic-agent-workflow',
        version: '0.1.0',
      },
    })
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
    }
  } catch (error) {
    connection.close()
    child.kill('SIGTERM')
    throw error
  }
}

async function stopProcess(active: ActiveProcess, graceMs: number): Promise<void> {
  active.connection.close()
  if (active.child.exitCode !== null || active.child.signalCode !== null) return
  active.child.kill('SIGTERM')
  const exited = new Promise<void>((resolve) => {
    active.child.once('exit', () => resolve())
  })
  const grace = createTimeout<void>(graceMs, 'ACP process did not stop after SIGTERM.')
  try {
    await Promise.race([exited, grace.promise])
  } catch {
    active.child.kill('SIGKILL')
  } finally {
    grace.clear()
  }
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
    completion: promptCompletion(active, sessionId, input.prompt, config),
    async cancel(): Promise<void> {
      await active.context.notify(methods.agent.session.cancel, { sessionId })
      await stopProcess(active, config.cancellationGraceMs)
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
  try {
    if (loadSessionId === undefined) {
      const session = await active.context.request(methods.agent.session.new, {
        cwd: input.workingDirectory,
        mcpServers,
      })
      return session.sessionId
    }
    if (active.capabilities?.loadSession !== true) {
      throw new AcpProtocolError('ACP agent does not advertise session/load support.')
    }
    await active.context.request(methods.agent.session.load, {
      cwd: input.workingDirectory,
      mcpServers,
      sessionId: loadSessionId,
    })
    return loadSessionId
  } catch (error) {
    await stopProcess(active, config.cancellationGraceMs)
    throw error
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
      await active.context.notify(methods.agent.session.cancel, { sessionId: providerSessionId })
      await stopProcess(active, config.cancellationGraceMs)
      activeBySession.delete(providerSessionId)
    },
  }
}
