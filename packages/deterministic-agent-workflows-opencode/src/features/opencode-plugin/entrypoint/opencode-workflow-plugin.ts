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
  WorkflowDefinition,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  reduceWorkflowStateFromStoredEvents,
  WorkflowEngine,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import type { PlatformContext } from '@nt-ai-lab/deterministic-agent-workflow-cli'
import {
  createPreToolUseHandler,
  createWorkflowRunner,
  getRepositoryName,
} from '@nt-ai-lab/deterministic-agent-workflow-cli'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type {
  IdleEventHookDeps,
  OpenCodePlugin,
  OpenCodeWorkflowPluginConfig,
} from '../../../platform/domain/opencode-workflow-plugin-types'
import { OpenCodeTranscriptReader } from '../../../platform/infra/external-clients/opencode/opencode-transcript-reader'

export const IDLE_RECOVERY_MESSAGE = 'You have stopped. You should never stop until the workflow is complete unless your current state permits stopping.'

const TRANSLATION_NOTE = [
  '> **OpenCode**: When instructions say to run a workflow command, call',
  '> the `workflow` tool instead: `operation: "<op>"`, `args: ["<arg>", ...]`.',
  '> Example: `<workflow-command> transition REVIEWING`',
  '>   → `workflow({ operation: "transition", args: ["REVIEWING"] })`',
  '> Example: `<workflow-command> record-review --type platform-review` with JSON stdin',
  '>   → `workflow({ operation: "record-review", args: ["--type", "platform-review"], stdin: "{...}" })`',
  '',
  '---',
  '',
  '',
].join('\n')

function injectTranslationNote(content: string): string {
  return `${TRANSLATION_NOTE}${content}`
}

function isSessionPromptClient(value: unknown): value is SessionPromptClient {
  return typeof value === 'object' && value !== null && 'session' in value
}

type OpenCodeToolExecuteBefore = NonNullable<Hooks['tool.execute.before']>
type OpenCodeToolBeforeInput = Parameters<OpenCodeToolExecuteBefore>[0]
type OpenCodeToolBeforeOutput = Parameters<OpenCodeToolExecuteBefore>[1]
type OpenCodeEventHook = NonNullable<Hooks['event']>
type OpenCodeCommandMap = NonNullable<OpenCodeConfig['command']>
type OpenCodePluginInput = Parameters<Plugin>[0]
type SessionPromptClient = {
  readonly session: {
    promptAsync: (input: {
      readonly path: { readonly id: string }
      readonly body: {
        readonly parts: Array<{
          readonly type: 'text';
          readonly text: string
        }>
      }
    }) => unknown
  }
}

function isIdleAllowedForSession<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState<TStateName>,
  TDeps,
  TStateName extends string = string,
  TOperation extends string = string,
>(
  workflowDefinition: WorkflowDefinition<TWorkflow, TState, TDeps, TStateName, TOperation>,
  engineDeps: WorkflowEngineDeps,
  sessionID: string,
): boolean {
  const currentState = reduceWorkflowStateFromStoredEvents(workflowDefinition, engineDeps.store.readEvents(sessionID))
  return workflowDefinition.getRegistry()[currentState.currentStateMachineState].allowIdle === true
}

async function promptIdleRecovery(client: SessionPromptClient, sessionID: string): Promise<void> {
  await client.session.promptAsync({
    path: { id: sessionID },
    body: {
      parts: [{
        type: 'text',
        text: IDLE_RECOVERY_MESSAGE,
      }],
    },
  })
}

/** @riviere-role cli-entrypoint */
export function createSessionIdleEventHook(deps: IdleEventHookDeps): OpenCodeEventHook {
  return async ({ event }): Promise<void> => {
    if (event.type !== 'session.idle') {
      return
    }
    if (!deps.hasSessionStarted(event.properties.sessionID)) {
      return
    }
    if (deps.isIdleAllowed(event.properties.sessionID)) {
      return
    }
    await deps.sendIdleRecoveryPrompt(event.properties.sessionID)
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

  function buildEngineContext(sessionID: string): {
    engineDeps: WorkflowEngineDeps
    workflowDeps: TDeps
  } {
    const transcriptReader = new OpenCodeTranscriptReader(sessionID)
    const now = () => new Date().toISOString()
    const rawReadFile = (path: string) => readFileSync(path, 'utf8')
    const readFile = config.routes === undefined
      ? rawReadFile
      : (path: string) => injectTranslationNote(rawReadFile(path))

    const engineDeps: WorkflowEngineDeps = {
      store,
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
  }

  return async (input?: OpenCodePluginInput): Promise<Hooks> => {
    const handler = config.customGates === undefined
      ? createPreToolUseHandler({
        bashForbidden: config.bashForbidden,
        isWriteAllowed: config.isWriteAllowed,
      })
      : createPreToolUseHandler({
        bashForbidden: config.bashForbidden,
        isWriteAllowed: config.isWriteAllowed,
        customGates: config.customGates,
      })
    const eventHook = createSessionIdleEventHook({
      hasSessionStarted: (sessionID) => {
        const {
          engineDeps, workflowDeps 
        } = buildEngineContext(sessionID)
        const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)
        return engine.hasSessionStarted(sessionID)
      },
      isIdleAllowed: (sessionID) => {
        const {
          engineDeps, workflowDeps 
        } = buildEngineContext(sessionID)
        void workflowDeps
        return isIdleAllowedForSession(config.workflowDefinition, engineDeps, sessionID)
      },
      sendIdleRecoveryPrompt: async (sessionID) => {
        if (input !== undefined && isSessionPromptClient(input.client)) {
          await promptIdleRecovery(input.client, sessionID)
        }
      },
    })

    const toolExecuteBefore = async (hookInput: OpenCodeToolBeforeInput, output: OpenCodeToolBeforeOutput): Promise<void> => {
      const {
        engineDeps, workflowDeps 
      } = buildEngineContext(hookInput.sessionID)
      const engine = new WorkflowEngine(config.workflowDefinition, engineDeps, workflowDeps)

      if (config.routes === undefined) {
        if (engine.hasSession(hookInput.sessionID)) {
          // Session already exists for the default non-router path.
        } else {
          engine.startSession(hookInput.sessionID, dbPath)
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
    }

    if (config.routes === undefined) {
      return {
        event: eventHook,
        'tool.execute.before': toolExecuteBefore,
      }
    }

    const routes = config.routes
    const workflowTool = tool({
      description: 'Execute a workflow operation (init, transition, record-*)',
      args: {
        operation: tool.schema.string().describe('operation name, e.g. "init", "transition", "record-issue"'),
        args: tool.schema.array(tool.schema.string()).optional().describe('operation arguments'),
        stdin: tool.schema.string().optional().describe('stdin content for workflow operations that read JSON from stdin'),
      },
      execute: async (rawArgs, ctx) => {
        const operation = rawArgs.operation
        const argList = rawArgs.args ?? []
        const stdin = rawArgs.stdin
        const {
          engineDeps, workflowDeps 
        } = buildEngineContext(ctx.sessionID)
        const runner = config.customGates === undefined
          ? createWorkflowRunner({
            workflowDefinition: config.workflowDefinition,
            routes,
            bashForbidden: config.bashForbidden,
            isWriteAllowed: config.isWriteAllowed,
          })
          : createWorkflowRunner({
            workflowDefinition: config.workflowDefinition,
            routes,
            bashForbidden: config.bashForbidden,
            isWriteAllowed: config.isWriteAllowed,
            customGates: config.customGates,
          })
        const result = runner([operation, ...argList], engineDeps, workflowDeps, {
          getSessionId: () => ctx.sessionID,
          getSessionTranscriptPath: () => dbPath,
          getSessionRepository: () => getRepositoryName(ctx.worktree),
          getRepositoryRoot: () => ctx.worktree,
          getWorkflowEventsDbPath: () => resolveWorkflowEventsDatabasePath(),
          ...(stdin === undefined ? {} : { readStdin: () => stdin }),
        })
        if (result.exitCode !== 0) {
          throw new TypeError(result.output)
        }
        return result.output
      },
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
  return join(homedir(), '.workflow-events.db')
}
