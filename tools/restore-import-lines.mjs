import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const rawFiles = execFileSync(
  'git',
  ['diff', '--name-only', '--', 'packages', 'apps/deterministic-agent-workflows-control-center/src'],
  { encoding: 'utf8' },
).trim()

const files = rawFiles === ''
  ? []
  : rawFiles.split('\n').filter((file) => file.endsWith('.ts'))

for (const file of files) {
  const current = readFileSync(file, 'utf8').split('\n')
  const original = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }).split('\n')

  const next = current.map((line, index) => {
    const oldLine = original[index] ?? ''
    const needsRestore = !line.includes('from')
      && (line.trim().startsWith('import') || line.trim().startsWith('export') || line.trim() === '}')

    if (!needsRestore || !oldLine.includes('from ')) {
      return line
    }

    return oldLine
      .replaceAll(".js'", "'")
      .replaceAll('.js"', '"')
  })

  writeFileSync(file, `${next.join('\n')}\n`)
}
