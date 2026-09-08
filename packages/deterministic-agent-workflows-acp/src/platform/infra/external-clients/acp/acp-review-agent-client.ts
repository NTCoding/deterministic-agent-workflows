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
import {
  AcpTimeoutError,
  cancelAcpSession,
  cancelTimedOutAcpPrompt,
  createAcpTimeout,
  stopAcpProcess,
  requireAcpProcessGroups,
} from './acp-process-supervision'

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

/** @riviere-role external-client-service */
export function buildProcessEnvironment(
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
    detached: true,
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
  const initializationTimeout = createAcpTimeout<never>(
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
    await stopAcpProcess({
      child,
      connection
    }, config.cancellationGraceMs, config.timeoutMs)
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

function promptCompletion(
  active: ActiveProcess,
  sessionId: string,
  prompt: string,
  config: AcpReviewAgentClientConfig,
): Promise<ReviewPayload> {
  return (async () => {
    const lifecycle = { cancellationOwnsCleanup: false }
    const timeout = createAcpTimeout<never>(
      config.timeoutMs,
      `ACP prompt timed out after ${String(config.timeoutMs)}ms.`,
    )
    const request = active.context.request(methods.agent.session.prompt, {
      sessionId,
      prompt: [{
        type: 'text',
        text: prompt
      }],
    })
    try {
      const response = await Promise.race([
        request,
        timeout.promise,
        active.processFailure,
      ])
      if (response.stopReason === 'cancelled') {
        throw new AcpProtocolError('ACP prompt was cancelled.')
      }
      if (response.stopReason !== 'end_turn') {
        throw new AcpProtocolError(`ACP prompt stopped without completion: ${response.stopReason}.`)
      }
      const output = active.outputBySession.get(sessionId)?.trim()
      if (output === undefined || output.length === 0) {
        const stderr = active.stderr().trim()
        throw new AcpProtocolError(
          stderr.length === 0 ? 'ACP agent returned no review output.' : `ACP agent returned no review output. stderr: ${stderr}`,
        )
      }
      return reviewPayloadSchema.parse(JSON.parse(output))
    } catch (error) {
      if (error instanceof AcpTimeoutError) {
        lifecycle.cancellationOwnsCleanup = true
        await cancelTimedOutAcpPrompt(error, () => cancelAcpSession({
          notify: () => active.context.notify(methods.agent.session.cancel, { sessionId }),
          processFailure: active.processFailure,
          prompt: request,
          stop: () => stopAcpProcess(active, config.cancellationGraceMs, config.timeoutMs),
          graceMs: config.cancellationGraceMs,
        }))
      }
      throw error
    } finally {
      timeout.clear()
      if (!lifecycle.cancellationOwnsCleanup) await stopAcpProcess(active, config.cancellationGraceMs, config.timeoutMs)
    }
  })()
}

function createRun(
  active: ActiveProcess,
  sessionId: string,
  input: ReviewAgentRequest,
  config: AcpReviewAgentClientConfig,
): ReviewAgentRun {
  const completion = promptCompletion(active, sessionId, input.prompt, config)
  return {
    providerSessionId: sessionId,
    providerRunId: randomUUID(),
    completion,
    cancel: () => cancelAcpSession({
      notify: () => active.context.notify(methods.agent.session.cancel, { sessionId }),
      processFailure: active.processFailure,
      prompt: completion,
      stop: () => stopAcpProcess(active, config.cancellationGraceMs, config.timeoutMs),
      graceMs: config.cancellationGraceMs,
    }),
  }
}

async function openSession(
  active: ActiveProcess,
  input: ReviewAgentRequest,
  loadSessionId: string | undefined,
  config: AcpReviewAgentClientConfig,
): Promise<string> {
  const mcpServers = [...(config.mcpServers ?? [])]
  const timeout = createAcpTimeout<never>(
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
    await stopAcpProcess(active, config.cancellationGraceMs, config.timeoutMs)
    throw error
  } finally {
    timeout.clear()
  }
}

/** @riviere-role external-client-service */
export function createAcpReviewAgentClient(
  config: AcpReviewAgentClientConfig,
): ReviewAgentClient {
  requireAcpProcessGroups()
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
  const activeByRun = new Map<string, ReviewAgentRun>()

  async function startSession(
    input: ReviewAgentRequest,
    loadSessionId?: string,
  ): Promise<ReviewAgentRun> {
    const active = await openProcess(config, input.workingDirectory)
    const sessionId = await openSession(active, input, loadSessionId, config)
    const run = createRun(active, sessionId, input, config)
    activeByRun.set(run.providerRunId, run)
    void run.completion.then(
      () => activeByRun.delete(run.providerRunId),
      () => activeByRun.delete(run.providerRunId),
    )
    return run
  }

  return {
    start: (input) => startSession(input),
    load: (input, providerSessionId) => startSession(input, providerSessionId),
    async cancel(providerSessionId: string, providerRunId: string): Promise<void> {
      const run = activeByRun.get(providerRunId)
      if (run === undefined) return
      if (run.providerSessionId !== providerSessionId) {
        throw new AcpProtocolError('ACP cancellation provider session does not match the active run.')
      }
      try {
        await run.cancel()
      } finally {
        activeByRun.delete(providerRunId)
      }
    },
  }
}
