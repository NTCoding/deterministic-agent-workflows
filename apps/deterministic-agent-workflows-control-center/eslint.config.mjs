import rootConfig from '../../eslint.config.mjs'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  ...rootConfig,
  {
    files: ['src/features/control-center/infra/web/client/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {parserOptions: {ecmaFeatures: { jsx: true },},},
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['src/features/control-center/infra/web/client/routes/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'] 
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'] 
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow' 
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'] 
        },
      ],
    },
  },
  {
    ignores: [
      'src/features/control-center/infra/web/client/routeTree.gen.ts',
      'dist/**',
      'dist-ssr/**',
      'node_modules/**',
      '.agents/**',
      '.claude/**',
      'vite.config.ts',
      'eslint.config.mjs',
      'tailwind.config.ts',
      'playwright.config.ts',
    ],
  },
  {
    files: ['src/features/control-center/infra/web/client/main.tsx'],
    rules: {'import/extensions': 'off',},
  },
  {
    files: ['src/features/control-center/infra/web/client/routes/-routes.integration.spec.tsx'],
    rules: {'import/extensions': 'off',},
  },
]
