import type { RoleEnforcementResult } from '@living-architecture/riviere-role-enforcement';
import { roles, workspacePackageSources } from './roles';

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
  roles,
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
  workspacePackageSources
};
