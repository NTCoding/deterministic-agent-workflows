import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  dirname, join 
} from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StartControlCenterInput } from '../features/control-center-cli/commands/start-control-center-input'
import { parseArgs } from '../features/control-center-cli/commands/start-control-center-input'
import type { SessionQueryDeps } from '../features/control-center/domain/query/session-queries'
import { getSessionCount } from '../features/control-center/domain/query/session-queries'
import {
  enableWalMode, openSqliteDatabase 
} from '../features/control-center/domain/query/sqlite-runtime'
import { createHttpServer } from '../features/control-center/infra/web/server/http-server'
import { createEventWatcher } from '../features/control-center/domain/watcher/event-watcher'
import { MissingDatabaseError } from '../platform/domain/missing-database-error'

/** @riviere-role main */
export async function startServer(cliArgs: StartControlCenterInput): Promise<{ readonly stop: () => Promise<void> }> {
  if (!existsSync(cliArgs.dbPath)) {
    throw new MissingDatabaseError(cliArgs.dbPath)
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
          httpServer.sseHub.broadcast('session-started', {sessionId: event.sessionId,})
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
    const openProcess = spawn('/usr/bin/open', [`http://localhost:${cliArgs.port}`], {
      detached: true,
      stdio: 'ignore',
    })
    openProcess.unref()
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
