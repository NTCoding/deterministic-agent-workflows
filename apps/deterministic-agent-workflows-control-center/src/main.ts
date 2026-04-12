import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionQueryDeps } from './query/session-queries.js'
import { getSessionCount } from './query/session-queries.js'
import { enableWalMode, openSqliteDatabase } from './query/sqlite-runtime.js'
import { createHttpServer } from './server/http-server.js'
import { createEventWatcher } from './watcher/event-watcher.js'

export type CliArgs = {
  readonly dbPath: string
  readonly port: number
  readonly open: boolean
}

export function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args = [...argv]
  const homeDir = process.env['HOME'] ?? '~'
  const envDb = process.env['WORKFLOW_EVENTS_DB']
  const defaultDb = envDb !== undefined && envDb !== ''
    ? envDb
    : join(homeDir, '.workflow-events.db')

  let dbPath = defaultDb
  let port = 3120
  let open = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--db' && index + 1 < args.length) {
      dbPath = args[++index] ?? defaultDb
    } else if (arg === '--port' && index + 1 < args.length) {
      port = parseInt(args[++index] ?? '3120', 10)
    } else if (arg === '--open') {
      open = true
    }
  }

  return { dbPath: resolve(dbPath), port, open }
}

export async function startServer(cliArgs: CliArgs): Promise<{ readonly stop: () => Promise<void> }> {
  if (!existsSync(cliArgs.dbPath)) {
    const message = [
      `Error: No event store found at ${cliArgs.dbPath}`,
      '',
      'The Workflow Control Center reads events from a deterministic-agent-workflows SQLite database.',
      'Specify the path with: pnpm start --db /path/to/workflow-events.db',
    ].join('\n')
    throw new Error(message)
  }

  const db = openSqliteDatabase(cliArgs.dbPath, { readonly: true })
  enableWalMode(db)

  const queryDeps: SessionQueryDeps = { db }

  const currentDir = dirname(fileURLToPath(import.meta.url))
  const distDir = join(currentDir, '..', 'dist', 'ui')

  const httpServer = createHttpServer({
    queryDeps,
    distDir,
    now: () => new Date(),
  })

  const watcher = createEventWatcher({
    queryDeps,
    onNewEvents(events) {
      for (const event of events) {
        httpServer.sseHub.broadcast('new-event', event, event.sessionId)

        if (event.type === 'transitioned') {
          httpServer.sseHub.broadcast(
            'state-change',
            {
              sessionId: event.sessionId,
              currentState: String(event.payload['to'] ?? 'unknown'),
              previousState: String(event.payload['from'] ?? 'unknown'),
            },
            event.sessionId,
          )
        }

        if (event.type === 'session-started') {
          httpServer.sseHub.broadcast('session-started', {
            sessionId: event.sessionId,
          })
        }
      }
    },
  })

  await httpServer.start(cliArgs.port)
  watcher.start()

  const sessionCount = getSessionCount(queryDeps)
  console.log('Workflow Control Center')
  console.log(`Database: ${cliArgs.dbPath}`)
  console.log(`Sessions: ${sessionCount}`)
  console.log('')
  console.log(`http://localhost:${cliArgs.port}`)

  if (cliArgs.open) {
    const { exec } = await import('node:child_process')
    exec(`open http://localhost:${cliArgs.port}`)
  }

  return {
    async stop() {
      watcher.stop()
      await httpServer.stop()
      db.close()
    },
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1])

if (isDirectRun) {
  const cliArgs = parseArgs(process.argv.slice(2))
  startServer(cliArgs).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
