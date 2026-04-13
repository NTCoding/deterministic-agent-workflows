import {
  appendFileSync, readFileSync 
} from 'node:fs'
import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import type { ProcessDeps } from '../../../domain/workflow-cli-types'

/** @riviere-role external-client-service */
export function createDefaultProcessDeps(): ProcessDeps {
  return {
    getEnv: (name) => process.env[name],
    exit: (code) => process.exit(code),
    writeStdout: (value) => { process.stdout.write(value) },
    writeStderr: (value) => { process.stderr.write(value) },
    getArgv: () => process.argv,
    readFile: (path) => readFileSync(path, 'utf8'),
    appendToFile: (path, content) => appendFileSync(path, content),
    buildStore: (dbPath) => createStore(dbPath),
  }
}
