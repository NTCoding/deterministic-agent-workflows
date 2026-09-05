import {
  Readable, Writable
} from 'node:stream'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'

const mode = process.env.FAKE_ACP_MODE ?? 'pass'
if (mode === 'early-exit') process.exit(17)
let cancelPrompt

const app = agent({ name: 'fake-review-agent' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: mode === 'wrong-version' ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION,
    agentCapabilities: {loadSession: mode === 'load',},
    agentInfo: {
      name: 'fake-review-agent',
      version: '1.0.0',
    },
  }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: 'fake-session' }))
  .onRequest(methods.agent.session.load, () => ({}))
  .onRequest(methods.agent.session.prompt, async ({
    params, client
  }) => {
    if (mode === 'slow' || mode === 'ignore-cancel') {
      await new Promise((resolve) => {
        cancelPrompt = mode === 'slow' ? resolve : undefined
      })
      return { stopReason: 'cancelled' }
    }
    const payload = mode === 'invalid-json'
      ? 'not-json'
      : JSON.stringify({
        verdict: 'PASS',
        summary: params.prompt[0]?.text,
        findings: []
      })
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: payload
        },
      },
    })
    return { stopReason: 'end_turn' }
  })
  .onNotification(methods.agent.session.cancel, () => {
    cancelPrompt?.()
  })

const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
)
const connection = app.connect(stream)
await connection.closed
