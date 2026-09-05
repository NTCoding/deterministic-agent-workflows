import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default {
  root: packageRoot,
  test: {
    globals: true,
  },
}
