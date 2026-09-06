import { createStore } from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { reviewBundleRequestSchema } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { ReviewCoordinator } from '../../dist/index.js'
import { z } from 'zod'

const database = z.string().min(1).parse(process.argv[2])
const request = reviewBundleRequestSchema.parse(JSON.parse(z.string().parse(process.argv[3])))
const store = createStore(database)
const keepAlive = setInterval(() => undefined, 1000)
const coordinator = new ReviewCoordinator({
  store,
  now: () => new Date().toISOString(),
  client: {
    async start(input) {
      return {
        providerSessionId: `persisted-${input.reviewType}`,
        providerRunId: `original-${input.reviewType}`,
        completion: new Promise(() => undefined),
        cancel: async () => undefined,
      }
    },
    async load() { throw new Error('Initial execution must not load a session.') },
    async cancel() { throw new Error('Fixture is terminated by its parent test.') },
  },
})
try {
  await coordinator.run(request, 'REVIEWING')
} finally {
  clearInterval(keepAlive)
  store.db.close()
}
