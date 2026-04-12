import type { RoleEnforcementResult } from '@living-architecture/riviere-role-enforcement';

const allTargets = ['class', 'function', 'interface', 'type-alias'] as const;

export const config: RoleEnforcementResult = {
  include: [
    'packages/deterministic-agent-workflows-engine/src/**/*.ts',
    'packages/deterministic-agent-workflows-dsl/src/**/*.ts',
    'packages/deterministic-agent-workflows-event-store/src/**/*.ts',
    'packages/deterministic-agent-workflows-claude-code/src/**/*.ts',
    'packages/deterministic-agent-workflows-opencode/src/**/*.ts',
    'apps/deterministic-agent-workflows-control-center/src/**/*.ts'
  ],
  ignorePatterns: [
    '**/*.spec.ts',
    '**/*.test.ts',
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**'
  ],
  roleDefinitionsDir: '.riviere/role-definitions',
  roles: [
    { name: 'engine', targets: allTargets },
    { name: 'dsl', targets: allTargets },
    { name: 'event-store', targets: allTargets },
    { name: 'claude-code', targets: allTargets },
    { name: 'opencode', targets: allTargets },
    { name: 'control-center', targets: allTargets }
  ],
  layers: {
    'packages/deterministic-agent-workflows-engine/src': {
      allowedRoles: ['engine'],
      paths: ['packages/deterministic-agent-workflows-engine/src'],
      forbiddenImports: [
        'packages/deterministic-agent-workflows-claude-code/src',
        'packages/deterministic-agent-workflows-opencode/src',
        'apps/deterministic-agent-workflows-control-center/src'
      ]
    },
    'packages/deterministic-agent-workflows-dsl/src': {
      allowedRoles: ['dsl'],
      paths: ['packages/deterministic-agent-workflows-dsl/src']
    },
    'packages/deterministic-agent-workflows-event-store/src': {
      allowedRoles: ['event-store'],
      paths: ['packages/deterministic-agent-workflows-event-store/src'],
      forbiddenImports: [
        'packages/deterministic-agent-workflows-claude-code/src',
        'packages/deterministic-agent-workflows-opencode/src'
      ]
    },
    'packages/deterministic-agent-workflows-claude-code/src': {
      allowedRoles: ['claude-code'],
      paths: ['packages/deterministic-agent-workflows-claude-code/src'],
      forbiddenImports: ['packages/deterministic-agent-workflows-dsl/src']
    },
    'packages/deterministic-agent-workflows-opencode/src': {
      allowedRoles: ['opencode'],
      paths: ['packages/deterministic-agent-workflows-opencode/src'],
      forbiddenImports: ['packages/deterministic-agent-workflows-dsl/src']
    },
    'apps/deterministic-agent-workflows-control-center/src': {
      allowedRoles: ['control-center'],
      paths: ['apps/deterministic-agent-workflows-control-center/src'],
      forbiddenImports: [
        'packages/deterministic-agent-workflows-dsl/src',
        'packages/deterministic-agent-workflows-claude-code/src',
        'packages/deterministic-agent-workflows-opencode/src'
      ]
    }
  },
  workspacePackageSources: {
    '@nick-tune/deterministic-agent-workflows-engine':
      'packages/deterministic-agent-workflows-engine/src/index.ts',
    '@nick-tune/deterministic-agent-workflows-dsl':
      'packages/deterministic-agent-workflows-dsl/src/index.ts',
    '@nick-tune/deterministic-agent-workflows-event-store':
      'packages/deterministic-agent-workflows-event-store/src/index.ts',
    '@nick-tune/deterministic-agent-workflows-claude-code':
      'packages/deterministic-agent-workflows-claude-code/src/index.ts',
    '@nick-tune/deterministic-agent-workflows-opencode':
      'packages/deterministic-agent-workflows-opencode/src/index.ts'
  }
};
