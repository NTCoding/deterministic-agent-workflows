import nx from '@nx/eslint-plugin'
import tseslint from 'typescript-eslint'
import noGenericNames from './.eslint-rules/no-generic-names.js'
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import importPlugin from 'eslint-plugin-import'
import sonarjs from 'eslint-plugin-sonarjs'
import stylistic from '@stylistic/eslint-plugin'
import unicorn from 'eslint-plugin-unicorn'
import vitest from '@vitest/eslint-plugin'

const customRules = {
  plugins: {
    custom: {
      rules: {
        'no-generic-names': noGenericNames,
      },
    },
    import: importPlugin,
  },
}

export default tseslint.config(
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/node_modules',
      '**/.nx',
      '**/*.d.ts',
      '**/coverage',
      '**/test-output',
      '.riviere/**',
    ],
  },
  eslintComments.recommended,
  {
    rules: {
      '@eslint-community/eslint-comments/no-use': ['error', { allow: [] }],
    },
  },
  sonarjs.configs.recommended,
  {
    rules: {
      'sonarjs/void-use': 'off',
    },
  },
  customRules,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'import/extensions': [
        'error',
        'never',
        { ts: 'never', tsx: 'never', js: 'never', json: 'always' },
      ],
      'custom/no-generic-names': 'error',
      'no-warning-comments': 'off',
      'multiline-comment-style': 'off',
      'capitalized-comments': 'off',
      'no-inline-comments': 'error',
      'spaced-comment': 'off',
      'no-negated-condition': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclaration[kind="let"]',
          message: 'Use const. Avoid mutation.',
        },
        {
          selector: 'NewExpression[callee.name="Error"]',
          message: 'Use custom precise error classes instead of generic Error or fail assertions in tests.',
        },
        {
          selector: 'LogicalExpression[operator="??"][right.type="Literal"][right.value=""]',
          message: 'Banned: ?? "" violates fail-fast principle.',
        },
      ],
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'import/no-duplicates': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/utils/*', '*/utils', '*/utilities'],
              message: 'No utils folders. Use domain-specific names.',
            },
            {
              group: ['*/helpers/*', '*/helpers'],
              message: 'No helpers folders. Use domain-specific names.',
            },
            {
              group: ['*/common/*', '*/common'],
              message: 'No common folders. Use domain-specific names.',
            },
            {
              group: ['*/shared/*', '*/shared'],
              message: 'No shared folders. Use domain-specific names.',
            },
            {
              group: ['*/core/*', '*/core'],
              message: 'No core folders. Use domain-specific names.',
            },
            {
              group: ['*/src/lib/*', '*/src/lib', './lib/*', './lib', '../lib/*', '../lib'],
              message: 'No lib folders in projects. Use domain-specific names.',
            },
          ],
        },
      ],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      complexity: ['error', 12],
      'no-restricted-globals': [
        'error',
        {
          name: '__dirname',
          message: 'Use dirname(fileURLToPath(import.meta.url)) in ESM',
        },
        {
          name: '__filename',
          message: 'Use fileURLToPath(import.meta.url) in ESM',
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase'],
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'UPPER_CASE'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['PascalCase'],
        },
        {
          selector: 'objectLiteralProperty',
          format: null,
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/indent': ['error', 2],
      '@stylistic/object-curly-newline': [
        'error',
        {
          multiline: true,
          minProperties: 2,
        },
      ],
      '@stylistic/object-property-newline': [
        'error',
        {
          allowAllPropertiesOnSameLine: false,
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-type-error': 'error',
    },
  },
  {
    files: [
      'apps/deterministic-agent-workflows-control-center/src/features/control-center/infra/web/components/**/*.ts',
      'apps/deterministic-agent-workflows-control-center/src/features/control-center/infra/web/server/handlers/transcript-handler.ts',
      'apps/deterministic-agent-workflows-control-center/src/features/control-center/infra/web/server/handlers/activity-handler.ts',
    ],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': 'off',
      'no-negated-condition': 'off',
      'no-inline-comments': 'off',
      'max-depth': 'off',
      'max-lines': 'off',
      complexity: 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/prefer-regexp-exec': 'off',
      'sonarjs/no-redundant-jump': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    plugins: { vitest },
    rules: {
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      'vitest/consistent-test-filename': ['error', { pattern: '.*\\.spec\\.[tj]sx?$' }],
      'vitest/max-expects': ['error', { max: 4 }],
      'vitest/prefer-called-with': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/prefer-spy-on': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
)
