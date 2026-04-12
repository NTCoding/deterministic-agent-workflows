import {
  createRoleFactory,
  type BuiltRole,
  type RoleTarget
} from '@living-architecture/riviere-role-enforcement';

export const roleNames = [
  'engine',
  'dsl',
  'event-store',
  'claude-code',
  'opencode',
  'control-center'
] as const;

export type RepoRole = (typeof roleNames)[number];

const defineRole = createRoleFactory<RepoRole>();
const allTargets: readonly RoleTarget[] = [
  'class',
  'function',
  'interface',
  'type-alias'
];

export const roles: readonly BuiltRole<RepoRole>[] = roleNames.map((name) =>
  defineRole(name, { targets: allTargets })
);

export const workspacePackageSources = {
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
} as const;
