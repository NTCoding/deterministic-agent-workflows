import {
  appendFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import {
  basename,
  extname,
  join,
} from 'node:path'
import { homedir } from 'node:os'
import type {
  Config as OpenCodeConfig,
  Hooks,
  Plugin,
} from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin/tool'
import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { WorkflowEngine } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { PlatformContext } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import {
  createPreToolUseHandler,
  createWorkflowRunner,
  formatStopPreventionMessage,
  getRepositoryName,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type {
  IdleEventHookDeps,
  OpenCodePlugin,
  OpenCodeWorkflowPluginConfig,
} from '../../../platform/domain/opencode-workflow-plugin-types'
import { OpenCodeTranscriptReader } from '../../../platform/infra/external-clients/opencode/opencode-transcript-reader'
import { createOpenCodeSessionContext } from '../../../platform/infra/external-clients/opencode/opencode-session-context'

export const IDLE_RECOVERY_MESSAGE = formatStopPreventionMessage()
const OPENCODE_QUESTION_TOOL = 'question'

const TRANSLATION_NOTE = [
  '> **OpenCode**: When instructions say to run a workflow command, call',
  '> the `workflow` tool instead: `operation: "<op>"`, `args: ["<arg>", ...]`.',
  '> Example: `<workflow-command> transition REVIEWING`',
  '>   → `workflow({ operation: "transition", args: ["REVIEWING"] })`',
  '> Example: `<workflow-command> record-review platform-review {...}`',
  '>   → `workflow({ operation: "record-review", args: ["platform-review", "{...}"] })`',
  '',
  '---',
  '',
  '',
].join('\n')

function injectTranslationNote(content: string): string {
  return `${TRANSLATION_NOTE}${content}`
}

type OpenCodeToolExecuteBefore = NonNullable<Hooks['tool.execute.before']>
type OpenCodeToolBeforeInput = Parameters<OpenCodeToolExecuteBefore>[0]
type OpenCodeToolBeforeOutput = Parameters<OpenCodeToolExecuteBefore>[1]
type OpenCodeEventHook = NonNullable<Hooks['event']>
type OpenCodeCommandMap = NonNullable<OpenCodeConfig['command']>
type OpenCodePluginInput = Parameters<Plugin>[0]

function createRunnerOptions(sessionID: string, worktree: string, dbPath: string) {
  return {
    getSessionId: () => sessionID,
    getSessionTranscriptPath: () => dbPath,
    getSessionRepository: () => getRepositoryName(worktree),
    getRepositoryRoot: () => worktree,
    getWorkflowEventsDbPath: () => resolveWorkflowEventsDatabasePath(),
  }
}

async function promptIdleRecovery(client: OpenCodePluginInput['client'], sessionID: string, customMessage?: string): Promise<void> {
  await client.session.promptAsync({
    path: { id: sessionID },
    body: {
      parts: [{
        type: 'text',
        text: formatStopPreventionMessage(undefined, customMessage),
      }],
    },
  })
}

/** @riviere-role cli-entrypoint */
export function createSessionIdleEventHook(deps: IdleEventHookDeps): OpenCodeEventHook {
  return ({ event }): Promise<void> => {
    if (event.type !== 'session.idle') {
      return Promise.resolve()
    }
    return deps.hasSessionStarted(event.properties.sessionID).then((hasSessionStarted) => {
      if (!hasSessionStarted) return undefined
      return deps.isIdleAllowed(event.properties.sessionID).then((isIdleAllowed) => {
        if (isIdleAllowed) return undefined
        return deps.sendIdleRecoveryPrompt(event.properties.sessionID)
      })
    })
  }
}

/** @riviere-role cli-entrypoint */
export function createOpenCodeWorkflowPlugin<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
>(
  config: OpenCodeWorkflowPluginConfig<TWorkflow, TState, TDeps, TStateName, TOperation>,
): OpenCodePlugin {
  const store = createStore(resolveWorkflowEventsDatabasePath())
  const dbPath = resolveOpenCodeDatabasePath(config.databasePath)

  function buildEngineContext(sessionID: string, input: OpenCodePluginInput): Promise<{
    engineDeps: WorkflowEngineDeps
    workflowDeps: TDeps
  }> {
    const transcriptReader = new OpenCodeTranscriptReader(sessionID)
    const now = () => new Date().toISOString()
    const rawReadFile = (path: string) => readFileSync(path, 'utf8')
    const readFile = config.routes === undefined
      ? rawReadFile
      : (path: string) => injectTranslationNote(rawReadFile(path))

    return createOpenCodeSessionContext(input.client, sessionID).then((sessionContext) => {
      const engineDeps: WorkflowEngineDeps = {
        store,
        sessionContext,
        getPluginRoot: () => config.pluginRoot,
        getEnvFilePath: () => join(homedir(), '.opencode', 'opencode.env'),
        getRepositoryName: () => getRepositoryName(process.cwd()),
        readFile,
        appendToFile: (path, content) => appendFileSync(path, content),
        now,
        transcriptReader,
      }

      const platformCtx: PlatformContext = {
        getPluginRoot: () => config.pluginRoot,
        now,
        getSessionId: () => sessionID,
        store,
      }

      return {
        engineDeps,
        workflowDeps: config.buildWorkflowDeps(platformCtx),
      }
    })
  }

  return async (input: OpenCodePluginInput): Promise<Hooks> => {
    const handler = config.customGates === undefined
      ? createPreToolUseHandler({
        bashForbidden: config.bashForbidden,
        isWriteAllowed: config.isWriteAllowed,
        questionToolName: OPENCODE_QUESTION_TOOL,
      })
      : createPreToolUseHandler({
        bashForbidden: config.bashForbidden,
        isWriteAllowed: config.isWriteAllowed,
        questionToolName: OPENCODE_QUESTION_TOOL,
        customGates: config.customGates,
      })
    const eventHook = createSessionIdleEventHook({
      hasSessionStarted: (sessionID) => buildEngineContext(sessionID, input).then(({
        engineDeps,
        workflowDeps,
      }) => {
        const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)
        return engine.hasSessionStarted(sessionID)
      }),
      isIdleAllowed: (sessionID) => buildEngineContext(sessionID, input).then(({
        engineDeps,
        workflowDeps,
      }) => {
        const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)
        return engine.checkStopping(sessionID, 'stop').type === 'success'
      }),
      sendIdleRecoveryPrompt: async (sessionID) => {
        await promptIdleRecovery(input.client, sessionID, config.stopPreventionMessage)
      },
    })

    const toolExecuteBefore = (hookInput: OpenCodeToolBeforeInput, output: OpenCodeToolBeforeOutput): Promise<void> => buildEngineContext(hookInput.sessionID, input).then(({
      engineDeps,
      workflowDeps,
    }) => {
      const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)

      if (config.routes === undefined) {
        if (engine.hasSession(hookInput.sessionID)) {
          // Session already exists for the default non-router path.
        } else {
          const repository = getRepositoryName(process.cwd())
          if (repository === undefined) throw new TypeError('repository must be a non-empty string.')
          engine.startSession(hookInput.sessionID, dbPath, repository)
        }
      } else if (engine.hasSessionStarted(hookInput.sessionID)) {
        // Routed mode only enforces tools after the session starts.
      } else {
        return
      }

      const result = handler(engine, hookInput.sessionID, hookInput.tool, output.args)
      if (result.type === 'blocked') {
        throw new TypeError(result.output)
      }
    })

    if (config.routes === undefined) {
      return {
        event: eventHook,
        'tool.execute.before': toolExecuteBefore,
      }
    }

    const routes = config.routes
    function executeWorkflowTool(
      rawArgs: {
        readonly operation: string
        readonly args?: readonly string[]
      },
      ctx: {
        readonly sessionID: string
        readonly worktree: string
      },
    ): Promise<string> {
      return buildEngineContext(ctx.sessionID, input).then(({
        engineDeps,
        workflowDeps,
      }) => {
        const operation = rawArgs.operation
        const argList = rawArgs.args ?? []
        const runner = config.customGates === undefined
          ? createWorkflowRunner({
            workflowDefinition: config.workflowDefinition,
            routes,
            unknownCommandMessage: config.unknownCommandMessage,
            bashForbidden: config.bashForbidden,
            isWriteAllowed: config.isWriteAllowed,
            questionToolName: OPENCODE_QUESTION_TOOL,
          })
          : createWorkflowRunner({
            workflowDefinition: config.workflowDefinition,
            routes,
            unknownCommandMessage: config.unknownCommandMessage,
            bashForbidden: config.bashForbidden,
            isWriteAllowed: config.isWriteAllowed,
            questionToolName: OPENCODE_QUESTION_TOOL,
            customGates: config.customGates,
          })
        const result = runner([operation, ...argList], engineDeps, workflowDeps, createRunnerOptions(ctx.sessionID, ctx.worktree, dbPath))
        if (result.exitCode !== 0) {
          throw new TypeError(result.output)
        }
        return result.output
      })
    }
    const workflowTool = tool({
      description: 'Execute a workflow operation (init, transition, record-*)',
      args: {
        operation: tool.schema.string().describe('operation name, e.g. "init", "transition", "record-issue"'),
        args: tool.schema.array(tool.schema.string()).optional().describe('operation arguments'),
      },
      execute: executeWorkflowTool,
    })

    const commands = loadCommands(resolveCommandDirectories(config.commandDirectories), resolveCommandPrefix(config.commandPrefix))

    return {
      event: eventHook,
      'tool.execute.before': toolExecuteBefore,
      tool: { workflow: workflowTool },
      ...(Object.keys(commands).length > 0
        ? {
          config: async (openCodeConfig: OpenCodeConfig) => {
            registerCommands(openCodeConfig, commands)
          },
        }
        : {}),
    }
  }
}

function loadCommands(
  commandDirectories: readonly string[],
  commandPrefix: string,
): OpenCodeCommandMap {
  const commands: OpenCodeCommandMap = {}
  for (const dir of commandDirectories) {
    const files = readCommandFiles(dir)
    if (files === undefined) {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const baseName = basename(file, extname(file))
      const name = `${commandPrefix}${baseName}`
      if (Object.hasOwn(commands, name)) continue
      const filePath = join(dir, file)
      const content = readFileSync(filePath, 'utf8')
      commands[name] = {
        description: `Workflow command: ${name}`,
        template: injectTranslationNote(content),
      }
    }
  }
  return commands
}

function registerCommands(config: OpenCodeConfig, commands: OpenCodeCommandMap): void {
  config.command ??= {}

  for (const [name, command] of Object.entries(commands)) {
    if (Object.hasOwn(config.command, name)) {
      continue
    }
    config.command[name] = command
  }
}

function readCommandFiles(directory: string): readonly string[] | undefined {
  try {
    return readdirSync(directory)
  } catch {
    return undefined
  }
}

function resolveCommandDirectories(directories: readonly string[] | undefined): readonly string[] {
  if (directories === undefined) {
    return []
  }
  return directories
}

function resolveCommandPrefix(prefix: string | undefined): string {
  if (prefix === undefined) {
    return ''
  }
  return prefix
}

function resolveOpenCodeDatabasePath(configured?: string): string {
  if (configured !== undefined) return configured
  return process.env['OPENCODE_DB'] ?? join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
}

function resolveWorkflowEventsDatabasePath(): string {
  const configured = process.env['WORKFLOW_EVENTS_DB']
  if (configured !== undefined && configured !== '') return configured
  return join(homedir(), 'ai-workflow-database', '.workflow-events.db')
}
