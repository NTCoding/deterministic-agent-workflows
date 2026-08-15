import {
  expect,
  it,
} from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

it('does not expose an agent-callable record-review operation', () => {
  const source = readFileSync(fileURLToPath(new URL('./workflow-runner.ts', import.meta.url)), 'utf8')
  expect(source).not.toContain("case 'record-review':")
})
