import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  dirname, join
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect, it, vi
} from 'vitest'
import { getRepositoryName } from './repository-name'

it('does not inherit a Git hook repository when resolving a different working directory', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../..')
  const gitDirectory = execFileSync('/usr/bin/git', ['rev-parse', '--absolute-git-dir'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const expectedRepository = getRepositoryName(root)
  const outside = mkdtempSync(join(tmpdir(), 'non-repository-'))
  vi.stubEnv('GIT_DIR', gitDirectory)
  vi.stubEnv('GIT_WORK_TREE', root)
  try {
    expect(getRepositoryName(outside)).toBeUndefined()
    expect(getRepositoryName(root)).toBe(expectedRepository)
  } finally {
    vi.unstubAllEnvs()
    rmSync(outside, {
      recursive: true,
      force: true,
    })
  }
})
