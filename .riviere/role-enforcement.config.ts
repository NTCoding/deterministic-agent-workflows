import { location, roleEnforcement } from '@living-architecture/riviere-role-enforcement'
import { allRoles, type RoleName } from './roles.ts'

const commandRoles: RoleName[] = [
  'command-use-case',
  'command-use-case-input',
  'command-use-case-result',
  'command-use-case-result-value',
  'command-input-factory',
]

const queryRoles: RoleName[] = [
  'query-model-use-case',
  'query-model-use-case-input',
  'query-model',
  'query-model-error',
]

const domainRoles: RoleName[] = [
  'aggregate',
  'value-object',
  'domain-service',
  'domain-error',
  'query-model',
]

const externalClientRoles: RoleName[] = [
  'external-client-service',
  'external-client-model',
  'external-client-error',
]

const cliPresentationRoles: RoleName[] = ['cli-output-formatter', 'cli-error']

const packages = [
  'packages/deterministic-agent-workflows-cli',
  'packages/deterministic-agent-workflows-engine',
  'packages/deterministic-agent-workflows-dsl',
  'packages/deterministic-agent-workflows-event-store',
  'packages/deterministic-agent-workflows-claude-code',
  'packages/deterministic-agent-workflows-opencode',
  'apps/deterministic-agent-workflows-control-center',
]

export const config = roleEnforcement({
  packages,
  canonicalConfigurationsFile: '.riviere/canonical-role-configurations.md',
  ignorePatterns: [
    '**/*.d.ts',
    '**/*.spec.ts',
    '**/__fixtures__/**',
    '**/*-fixtures.ts',
    '**/test-fixtures.ts',
    '**/test-fixture-*.ts',
  ],
  roleDefinitionsDir: '.riviere/role-definitions',
  roles: allRoles,
  workspacePackageSources: {
    '@nt-ai-lab/deterministic-agent-workflow-cli': 'packages/deterministic-agent-workflows-cli/src/index.ts',
    '@nt-ai-lab/deterministic-agent-workflow-engine': 'packages/deterministic-agent-workflows-engine/src/index.ts',
    '@nt-ai-lab/deterministic-agent-workflow-dsl': 'packages/deterministic-agent-workflows-dsl/src/index.ts',
    '@nt-ai-lab/deterministic-agent-workflow-event-store': 'packages/deterministic-agent-workflows-event-store/src/index.ts',
    '@nt-ai-lab/deterministic-agent-workflow-claude-code': 'packages/deterministic-agent-workflows-claude-code/src/index.ts',
    '@nt-ai-lab/deterministic-agent-workflow-opencode': 'packages/deterministic-agent-workflows-opencode/src/index.ts',
  },

  locations: [
    location<RoleName>('src/features/{feature}')
      .subLocation('/entrypoint', ['cli-entrypoint'], {
        forbiddenImports: ['**/infra/persistence/**'],
      })
      .subLocation('/commands', commandRoles, { forbiddenImports: ['**/infra/cli/**'] })
      .subLocation('/queries', queryRoles, { forbiddenImports: ['**/infra/cli/**'] })
      .subLocation('/domain', domainRoles)
      .subLocation('/infra/web', ['web-tbc'])
      .subLocation('/infra/external-clients/{client}', externalClientRoles)
      .subLocation('/infra/persistence', ['aggregate-repository', 'query-model-loader'])
      .subLocation('/infra/cli/output', ['cli-output-formatter']),

    location<RoleName>('src/platform')
      .subLocation('/domain', domainRoles)
      .subLocation('/infra/external-clients/{client}', externalClientRoles)
      .subLocation('/infra/cli/input', ['cli-input-validator'])
      .subLocation('/infra/cli/presentation', cliPresentationRoles),

    location<RoleName>('src/shell', ['main']),
  ],
})
