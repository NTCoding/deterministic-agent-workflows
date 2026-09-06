import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const logPath = process.env.FAKE_ACP_LOG
const descendant = spawn(process.execPath, ['--input-type=module', '-e', `
  process.on('SIGTERM', () => undefined)
  setInterval(() => undefined, 1000)
  process.send('ready')
`], {stdio: ['ignore', 'inherit', 'inherit', 'ipc'],})
await new Promise((resolve, reject) => {
  descendant.once('error', reject)
  descendant.once('message', resolve)
})
appendFileSync(logPath, `${process.pid} parent-ready\n${descendant.pid} descendant-ready\n`)
await import('./fake-acp-agent.mjs')
