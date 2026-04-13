import { join } from 'node:path'
import type {
  BaseWorkflowState,
  RehydratableWorkflow,
  WorkflowEngineDeps,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createWorkflowRunner } from '../../workflow-runner/entrypoint/workflow-runner'
import type { PlatformContext } from '../../../platform/domain/platform-context'
import type {
  ProcessDeps,
  WorkflowCliConfig,
} from '../../../platform/domain/workflow-cli-types'
import type { RunnerResult } from '../../../platform/domain/workflow-runner-types'
import { getRepositoryName } from '../../../platform/infra/external-clients/git/repository-name'

function buildReadEnvVar(getEnv: (name: string) => string | undefined) {
  return function readEnvVar(name: string): string {
    const value = getEnv(name)
    if (value === undefined || value === '') {
      throw new TypeError(`Missing required environment variable: ${name}`)
    }
    return value
  }
}

/** @riviere-role cli-entrypoint */
export function createWorkflowCli<
  TWorkflow extends RehydratableWorkflow<TState>,
  TState extends BaseWorkflowState,
  TDeps,
>(
  config: WorkflowCliConfig<TWorkflow, TState, TDeps>,
): void {
  const { processDeps } = config
  const readEnvVar = buildReadEnvVar(processDeps.getEnv)

  const pluginRoot = readEnvVar('CLAUDE_PLUGIN_ROOT')
  const getSessionId = () => readEnvVar('CLAUDE_SESSION_ID')

  const configuredWorkflowEventsDbPath = processDeps.getEnv('WORKFLOW_EVENTS_DB')
  const workflowEventsDbPath = configuredWorkflowEventsDbPath !== undefined && configuredWorkflowEventsDbPath !== ''
    ? configuredWorkflowEventsDbPath
    : join(readEnvVar('HOME'), '.workflow-events.db')

  const store = processDeps.buildStore(workflowEventsDbPath)
  const now = () => new Date().toISOString()

  const platformCtx: PlatformContext = {
    getPluginRoot: () => pluginRoot,
    now,
    getSessionId,
    store,
  }

  const engineDeps: WorkflowEngineDeps = {
    store,
    getPluginRoot: () => pluginRoot,
    getEnvFilePath: () => join(readEnvVar('HOME'), '.claude', 'claude.env'),
    getRepositoryName: () => getRepositoryName(process.cwd()),
    readFile: processDeps.readFile,
    appendToFile: processDeps.appendToFile,
    now,
    transcriptReader: config.transcriptReader,
  }

  const workflowDeps = config.buildWorkflowDeps(platformCtx)
  const readStdin = () => processDeps.readFile('/dev/stdin')
  const errorLogPath = join(pluginRoot, 'error.log')

  try {
    const args = processDeps.getArgv().slice(2)
    const command = args[0]

    if (args.length > 0 && config.customRouter !== undefined) {
      const custom = config.customRouter(command, args, platformCtx)
      if (custom !== undefined) {
        writeRunnerResult(processDeps, custom)
        return
      }
    }

    const runner = createWorkflowRunner(config)
    const result = runner(args, engineDeps, workflowDeps, {
      readStdin,
      getSessionId,
    })

    if (result.output) {
      processDeps.writeStdout(result.output)
    }
    processDeps.exit(result.exitCode)
  } catch (error: unknown) {
    const message = `[${new Date().toISOString()}] ERROR: ${String(error)}\n`
    processDeps.writeStderr(message)
    try {
      processDeps.appendToFile(errorLogPath, message)
    } catch {
      // Ignore write failures to error log.
    }
    processDeps.exit(1)
  }
}

function writeRunnerResult(processDeps: ProcessDeps, result: RunnerResult): void {
  if (result.output !== '') {
    processDeps.writeStdout(result.output)
  }
  processDeps.exit(result.exitCode)
}
