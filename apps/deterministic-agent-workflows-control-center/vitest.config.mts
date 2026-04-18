import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const appRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: appRoot,
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['**/*.spec.tsx', 'jsdom'],
      ['**/*.test.tsx', 'jsdom'],
      ['src/features/control-center/infra/web/client/**/*.spec.ts', 'jsdom'],
    ],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/*.spec.tsx',
        'src/**/*-test-fixtures.ts',
        'src/**/*-test-fixtures.tsx',
        'src/features/control-center/domain/query/query-types.ts',
        'src/features/control-center/infra/web/app.ts',
        'src/features/control-center/infra/web/api-client.ts',
        'src/features/control-center/infra/web/api-types.ts',
        'src/features/control-center/infra/web/dom.ts',
        'src/features/control-center/infra/web/render.ts',
        'src/features/control-center/infra/web/router.ts',
        'src/features/control-center/infra/web/sse-client.ts',
        'src/features/control-center/infra/web/components/**',
        'src/features/control-center/infra/web/views/**',
        'src/features/control-center/infra/web/server/**',
        'src/features/control-center/infra/web/client/main.tsx',
        'src/features/control-center/infra/web/client/routeTree.gen.ts',
        'src/platform/domain/missing-database-error.ts',
        'src/shell/main.ts',
      ],
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 100,
        branches: 97,
      },
    },
  },
})
