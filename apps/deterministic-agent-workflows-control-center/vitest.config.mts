import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const appRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: appRoot,
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.spec.ts',
          'src/**/*-test-fixtures.ts',
          'src/features/control-center/domain/query/query-types.ts',
          'src/features/control-center/infra/web/app.ts',
          'src/features/control-center/infra/web/api-client.ts',
          'src/features/control-center/infra/web/dom.ts',
          'src/features/control-center/infra/web/render.ts',
          'src/features/control-center/infra/web/router.ts',
          'src/features/control-center/infra/web/sse-client.ts',
          'src/features/control-center/infra/web/views/**',
          'src/features/control-center/infra/web/components/**',
          'src/features/control-center/infra/web/api-types.ts',
          'src/features/control-center/infra/web/server/handlers/activity-handler.ts',
          'src/features/control-center/infra/web/server/handlers/transcript-handler.ts',
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
