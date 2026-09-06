import { execFileSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expect, it, vi
} from 'vitest'
import { getRepositoryName } from './repository-name'

it('resolves the explicit repository despite inherited hook and configuration overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'repository-name-'))
  const root = join(directory, 'repository')
  const outside = join(directory, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (args: string[]) => execFileSync('/usr/bin/git', args, {
    cwd: root,
    env,
    encoding: 'utf8',
  })
  try {
    git(['init', '--quiet'])
    git(['remote', 'add', 'origin', 'https://github.com/fixture/expected.git'])
    vi.stubEnv('GIT_DIR', join(root, '.git'))
    vi.stubEnv('GIT_WORK_TREE', root)
    expect(getRepositoryName(outside)).toBeUndefined()
    expect(getRepositoryName(root)).toBe('fixture/expected')
    vi.stubEnv('GIT_CONFIG_COUNT', '1')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'remote.origin.url')
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'https://github.com/injected/wrong.git')
    expect(getRepositoryName(root)).toBe('fixture/expected')
    expect(getRepositoryName(outside)).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})
