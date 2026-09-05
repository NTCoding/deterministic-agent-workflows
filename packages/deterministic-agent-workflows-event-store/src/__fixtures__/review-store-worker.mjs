import {
  parentPort, workerData
} from 'node:worker_threads'
import { createStore } from '../../dist/index.js'

const store = createStore(workerData.path)
store.db.exec('PRAGMA busy_timeout = 5000')
parentPort.postMessage({ type: 'ready' })
Atomics.wait(new Int32Array(workerData.barrier), 0, 0)
try {
  const {
    action, request, provenance, at
  } = workerData
  switch (action) {
    case 'claim':
      store.claimReviewBundle(request, at)
      break
    case 'complete':
      store.completeReviewAgent(request.bundleId, 'custom-review', provenance, at, {
        reviewType: 'custom-review',
        verdict: 'PASS',
        findings: [],
      }, 'REVIEWING')
      break
    case 'cancel':
      store.cancelReviewBundle(request.bundleId, 'User cancelled.', at)
      break
    default:
      throw new TypeError(`Unknown fixture action: ${action}`)
  }
  parentPort.postMessage({ type: 'accepted' })
} catch (error) {
  parentPort.postMessage({
    type: 'rejected',
    reason: String(error)
  })
} finally {
  store.db.close()
  parentPort.close()
}
