/** @riviere-role domain-error */
export class MissingDatabaseError extends Error {
  constructor(dbPath: string) {
    super([
      `Error: No event store found at ${dbPath}`,
      '',
      'The Workflow Control Center reads events from a deterministic-agent-workflows SQLite database.',
      'Specify the path with: pnpm start --db /path/to/workflow-events.db',
    ].join('\n'))
    this.name = 'MissingDatabaseError'
  }
}
