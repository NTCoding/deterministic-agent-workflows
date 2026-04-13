import {
  join,
  resolve,
} from 'node:path'

/** @riviere-role command-use-case-input */
export type StartControlCenterInput = {
  readonly dbPath: string
  readonly port: number
  readonly open: boolean
}

/** @riviere-role command-input-factory */
export function parseArgs(argv: ReadonlyArray<string>): StartControlCenterInput {
  const args = [...argv]
  const homeDir = process.env['HOME'] ?? '~'
  const envDb = process.env['WORKFLOW_EVENTS_DB']
  const defaultDb = envDb !== undefined && envDb !== ''
    ? envDb
    : join(homeDir, '.workflow-events.db')

  const parsed = args.reduce(
    (state, arg, index) => {
      if (state.skipNext) {
        return {
          ...state,
          skipNext: false,
        }
      }
      if (arg === '--db' && index + 1 < args.length) {
        return {
          ...state,
          dbPath: args[index + 1] ?? defaultDb,
          skipNext: true,
        }
      }
      if (arg === '--port' && index + 1 < args.length) {
        return {
          ...state,
          port: parseInt(args[index + 1] ?? '3120', 10),
          skipNext: true,
        }
      }
      if (arg === '--open') {
        return {
          ...state,
          open: true,
        }
      }
      return state
    },
    {
      dbPath: defaultDb,
      port: 3120,
      open: false,
      skipNext: false,
    },
  )

  return {
    dbPath: resolve(parsed.dbPath),
    port: parsed.port,
    open: parsed.open,
  }
}
