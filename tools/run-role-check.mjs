import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { RunRoleEnforcement } from '@living-architecture/riviere-role-enforcement'

const configModulePath = process.argv[2]

if (configModulePath === undefined || configModulePath === '') {
  process.stderr.write('Usage: node tools/run-role-check.mjs <config-module-path> [--package <package-path>]\n')
  process.exitCode = 1
} else {
  const packageFilter = readPackageFilter(process.argv)
  const absolutePath = path.resolve(configModulePath)
  const loaded = await import(absolutePath)
  const result = new RunRoleEnforcement({
    oxlintAdapter: ({ oxlintConfig, configDir, lintTargets }) => runLocalOxlint(oxlintConfig, configDir, lintTargets),
  }).execute({
    configDir: process.cwd(),
    configModule: loaded,
    ...(packageFilter === undefined ? {} : { packageFilter }),
  })

  if (result.stdout !== '') {
    process.stdout.write(result.stdout)
  }
  if (result.stderr !== '') {
    process.stderr.write(result.stderr)
  }
  process.stderr.write(`Role enforcement completed in ${Math.round(result.durationMs)}ms\n`)
  process.exitCode = result.exitCode
}

function runLocalOxlint(oxlintConfig, configDir, lintTargets) {
  const oxlintBinaryPath = path.resolve(configDir, 'node_modules', '.bin', 'oxlint')
  const oxlintConfigPath = path.join(configDir, `.oxlintrc.role-enforcement.${process.pid}.${Date.now()}.json`)
  writeFileSync(oxlintConfigPath, JSON.stringify(oxlintConfig, null, 2))

  try {
    const commandResult = spawnSync(oxlintBinaryPath, ['-c', oxlintConfigPath, ...lintTargets], {
      cwd: configDir,
      encoding: 'utf8',
    })
    return {
      exitCode: commandResult.status ?? 1,
      stderr: commandResult.stderr ?? '',
      stdout: commandResult.stdout ?? '',
    }
  } finally {
    rmSync(oxlintConfigPath, { force: true })
  }
}

function readPackageFilter(argv) {
  const flagIndex = argv.indexOf('--package')
  if (flagIndex < 0) {
    return undefined
  }

  const value = argv[flagIndex + 1]
  if (value === undefined || value === '') {
    process.stderr.write('Error: --package requires a value\n')
    process.exitCode = 1
    return undefined
  }

  return value
}
