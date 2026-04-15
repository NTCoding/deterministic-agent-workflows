import { build, context } from 'esbuild'
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))
const outDir = join(appDir, 'dist/ui')
const srcDir = join(appDir, 'src/ui')
const appEntryPoint = join(appDir, 'src/features/control-center/infra/web/app.ts')
const watch = process.argv.includes('--watch')

async function buildCss() {
  const files = ['tokens.css', 'layout.css', 'components.css']
  const parts = await Promise.all(
    files.map((file) => readFile(join(srcDir, 'styles', file), 'utf8')),
  )
  await mkdir(join(outDir), { recursive: true })
  await writeFile(join(outDir, 'styles.css'), parts.join('\n'))
}

async function buildHtml() {
  await mkdir(outDir, { recursive: true })
  await cp(join(srcDir, 'index.html'), join(outDir, 'index.html'))
}

const esbuildOptions = {
  entryPoints: [appEntryPoint],
  bundle: true,
  outfile: join(outDir, 'app.js'),
  format: 'iife',
  target: 'es2022',
  minify: !watch,
  sourcemap: watch,
}

async function runBuild() {
  await Promise.all([buildCss(), buildHtml()])

  if (watch) {
    const ctx = await context(esbuildOptions)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    await build(esbuildOptions)
    console.log('UI built to dist/ui/')
  }
}

runBuild().catch((err) => {
  console.error(err)
  process.exit(1)
})
