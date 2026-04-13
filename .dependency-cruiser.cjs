/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'engine-no-adapter-imports',
      severity: 'error',
      comment: 'engine must not depend on claude-code or opencode adapters',
      from: { path: '^packages/deterministic-agent-workflows-engine/src' },
      to: {
        path: '(^packages/deterministic-agent-workflows-(claude-code|opencode)/src)|(^@nt-ai-lab/deterministic-agent-workflow-(claude-code|opencode)$)',
      },
    },
    {
      name: 'engine-no-app-imports',
      severity: 'error',
      comment: 'engine must not depend on control-center app',
      from: { path: '^packages/deterministic-agent-workflows-engine/src' },
      to: {
        path: '(^apps/deterministic-agent-workflows-control-center/src)|(^deterministic-agent-workflows-control-center$)',
      },
    },
    {
      name: 'event-store-no-adapter-imports',
      severity: 'error',
      comment: 'event-store must not depend on adapter packages',
      from: { path: '^packages/deterministic-agent-workflows-event-store/src' },
      to: {
        path: '(^packages/deterministic-agent-workflows-(claude-code|opencode)/src)|(^@nt-ai-lab/deterministic-agent-workflow-(claude-code|opencode)$)',
      },
    },
    {
      name: 'claude-code-no-dsl-imports',
      severity: 'error',
      comment: 'claude-code adapter must not depend on dsl package',
      from: { path: '^packages/deterministic-agent-workflows-claude-code/src' },
      to: {
        path: '(^packages/deterministic-agent-workflows-dsl/src)|(^@nt-ai-lab/deterministic-agent-workflow-dsl$)',
      },
    },
    {
      name: 'opencode-no-dsl-imports',
      severity: 'error',
      comment: 'opencode adapter must not depend on dsl package',
      from: { path: '^packages/deterministic-agent-workflows-opencode/src' },
      to: {
        path: '(^packages/deterministic-agent-workflows-dsl/src)|(^@nt-ai-lab/deterministic-agent-workflow-dsl$)',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: [
        'npm',
        'npm-dev',
        'npm-optional',
        'npm-peer',
        'npm-bundled',
        'npm-no-pkg',
      ],
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    externalModuleResolutionStrategy: 'node_modules',
  },
}
