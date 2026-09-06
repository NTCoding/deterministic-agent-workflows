import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./rewrite-relative-import-extensions.mjs', import.meta.url))

test('rewrites emitted JavaScript and declarations recursively without changing source or package imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'import-extension-test-'))
  const nested = join(root, 'nested')
  mkdirSync(nested)
  const input = [
    "export { value } from './value'",
    "import type { Value } from '../types'",
    "export { ready } from './ready.js'",
    "export { z } from 'zod'",
    '',
  ].join('\n')
  const expected = input.replace("'./value'", "'./value.js'").replace("'../types'", "'../types.js'")
  const files = ['index.js', 'index.d.ts', 'source.ts']
  try {
    for (const name of files) writeFileSync(join(nested, name), input)
    execFileSync(process.execPath, [script, root])
    assert.equal(readFileSync(join(nested, 'index.js'), 'utf8'), expected)
    assert.equal(readFileSync(join(nested, 'index.d.ts'), 'utf8'), expected)
    assert.equal(readFileSync(join(nested, 'source.ts'), 'utf8'), input)
    execFileSync(process.execPath, [script, root])
    assert.equal(readFileSync(join(nested, 'index.d.ts'), 'utf8'), expected)
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})
