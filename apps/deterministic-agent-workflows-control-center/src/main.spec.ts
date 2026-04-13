import {
  describe, it, expect 
} from 'vitest'
import { parseArgs } from './features/control-center-cli/commands/start-control-center-input'

describe('parseArgs', () => {
  it('returns defaults when no args provided', () => {
    const args = parseArgs([])
    expect(args.port).toBe(3120)
    expect(args.open).toBe(false)
    expect(args.dbPath).toContain('.workflow-events.db')
  })

  it('parses --db flag', () => {
    const args = parseArgs(['--db', '/custom/path.db'])
    expect(args.dbPath).toBe('/custom/path.db')
  })

  it('parses --port flag', () => {
    const args = parseArgs(['--port', '8080'])
    expect(args.port).toBe(8080)
  })

  it('parses --open flag', () => {
    const args = parseArgs(['--open'])
    expect(args.open).toBe(true)
  })

  it('parses multiple flags together', () => {
    const args = parseArgs(['--db', '/test.db', '--port', '9090', '--open'])
    expect(args.dbPath).toBe('/test.db')
    expect(args.port).toBe(9090)
    expect(args.open).toBe(true)
  })

  it('uses WORKFLOW_EVENTS_DB when set', () => {
    process.env['WORKFLOW_EVENTS_DB'] = '/from-env.db'
    const args = parseArgs([])
    expect(args.dbPath).toBe('/from-env.db')
    delete process.env['WORKFLOW_EVENTS_DB']
  })

  it('ignores unknown flags', () => {
    const args = parseArgs(['--unknown', 'value'])
    expect(args.port).toBe(3120)
    expect(args.open).toBe(false)
  })
})
