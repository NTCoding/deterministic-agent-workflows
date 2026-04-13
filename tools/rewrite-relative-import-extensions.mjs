import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const [, , rootDir] = process.argv

if (rootDir === undefined || rootDir === '') {
  throw new TypeError('Expected a dist directory path.')
}

rewriteDirectory(rootDir)

function rewriteDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      rewriteDirectory(entryPath)
      continue
    }
    if (entry.isFile() && extname(entry.name) === '.js') {
      rewriteFile(entryPath)
    }
  }
}

function rewriteFile(filePath) {
  const original = readFileSync(filePath, 'utf8')
  const rewritten = original.replace(
    /((?:import|export)\s[^'"\n]*?from\s+['"])(\.{1,2}\/[^'"\n]+?)(['"])/g,
    (match, prefix, specifier, suffix) => {
      if (hasExtension(specifier)) return match
      return `${prefix}${specifier}.js${suffix}`
    },
  )

  if (rewritten !== original) {
    writeFileSync(filePath, rewritten)
  }
}

function hasExtension(specifier) {
  const lastSegment = specifier.split('/').at(-1)
  if (lastSegment === undefined) return false
  return /\.[A-Za-z0-9]+$/.test(lastSegment)
}
