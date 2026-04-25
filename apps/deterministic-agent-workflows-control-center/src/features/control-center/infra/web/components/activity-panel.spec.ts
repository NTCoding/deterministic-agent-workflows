import {
  describe,
  it,
  expect,
} from 'vitest'
import type {
  ActivityReport,
  ActivityResponse,
} from '../api-client'
import { renderActivityPanel } from './activity-panel'

describe('renderActivityPanel', () => {
  describe('workflow commands rendering', () => {
    it('renders workflow section when workflowCommands are present', () => {
      const report: ActivityReport = {
        totalToolCalls: 1,
        toolCounts: { Workflow: 1 },
        bashCommands: [],
        bashTotal: 0,
        workflowCommands: [
          {
            command: 'task do_something',
            count: 1,
          },
        ],
        failedCommands: [],
        filesRead: [],
        filesEdited: [],
        filesWritten: [],
        filesTouchedTotal: 0,
        grepSearches: [],
        globSearches: [],
        tasksDelegated: [],
        webFetches: [],
        webSearches: [],
      }
      const response: ActivityResponse = {
        overall: report,
        byState: [],
      }
      const html = renderActivityPanel(response)
      expect(html).toContain('Workflow commands')
      expect(html).toContain('task do_something')
    })

    it('does not render workflow section when no workflowCommands', () => {
      const report: ActivityReport = {
        totalToolCalls: 1,
        toolCounts: { Bash: 1 },
        bashCommands: [
          {
            command: 'ls',
            count: 1
          },
        ],
        bashTotal: 1,
        workflowCommands: [],
        failedCommands: [],
        filesRead: [],
        filesEdited: [],
        filesWritten: [],
        filesTouchedTotal: 0,
        grepSearches: [],
        globSearches: [],
        tasksDelegated: [],
        webFetches: [],
        webSearches: [],
      }
      const response: ActivityResponse = {
        overall: report,
        byState: [],
      }
      const html = renderActivityPanel(response)
      expect(html).not.toContain('Workflow commands')
    })
  })

  describe('failed commands rendering', () => {
    it('renders failed commands section when failedCommands are present', () => {
      const report: ActivityReport = {
        totalToolCalls: 1,
        toolCounts: { Bash: 1 },
        bashCommands: [],
        bashTotal: 1,
        workflowCommands: [],
        failedCommands: [
          {
            toolName: 'Bash',
            command: 'ls /nonexistent',
            output: 'ls: /nonexistent: No such file or directory',
            count: 1,
          },
        ],
        filesRead: [],
        filesEdited: [],
        filesWritten: [],
        filesTouchedTotal: 0,
        grepSearches: [],
        globSearches: [],
        tasksDelegated: [],
        webFetches: [],
        webSearches: [],
      }
      const response: ActivityResponse = {
        overall: report,
        byState: [],
      }
      const html = renderActivityPanel(response)
      expect(html).toContain('Failed')
      expect(html).toContain('ls /nonexistent')
    })

    it('does not render failed section when no failedCommands', () => {
      const report: ActivityReport = {
        totalToolCalls: 1,
        toolCounts: { Bash: 1 },
        bashCommands: [
          {
            command: 'ls',
            count: 1
          },
        ],
        bashTotal: 1,
        workflowCommands: [],
        failedCommands: [],
        filesRead: [],
        filesEdited: [],
        filesWritten: [],
        filesTouchedTotal: 0,
        grepSearches: [],
        globSearches: [],
        tasksDelegated: [],
        webFetches: [],
        webSearches: [],
      }
      const response: ActivityResponse = {
        overall: report,
        byState: [],
      }
      const html = renderActivityPanel(response)
      expect(html).not.toContain('Failed')
    })

    it('highlights failed command output', () => {
      const report: ActivityReport = {
        totalToolCalls: 1,
        toolCounts: { Bash: 1 },
        bashCommands: [],
        bashTotal: 1,
        workflowCommands: [],
        failedCommands: [
          {
            toolName: 'Bash',
            command: 'npm run build',
            output: 'exit code 1',
            count: 1,
          },
        ],
        filesRead: [],
        filesEdited: [],
        filesWritten: [],
        filesTouchedTotal: 0,
        grepSearches: [],
        globSearches: [],
        tasksDelegated: [],
        webFetches: [],
        webSearches: [],
      }
      const response: ActivityResponse = {
        overall: report,
        byState: [],
      }
      const html = renderActivityPanel(response)
      expect(html).toContain('npm run build')
      expect(html).toContain('exit code 1')
    })

    it('shows multiple failed commands sorted by count', () => {
      const report: ActivityReport = {
        totalToolCalls: 3,
        toolCounts: { Bash: 3 },
        bashCommands: [],
        bashTotal: 3,
        workflowCommands: [],
        failedCommands: [
          {
            toolName: 'Bash',
            command: 'cmd_a',
            output: 'error a',
            count: 2,
          },
          {
            toolName: 'Bash',
            command: 'cmd_b',
            output: 'error b',
            count: 1,
          },
        ],
        filesRead: [],
        filesEdited: [],
        filesWritten: [],
        filesTouchedTotal: 0,
        grepSearches: [],
        globSearches: [],
        tasksDelegated: [],
        webFetches: [],
        webSearches: [],
      }
      const response: ActivityResponse = {
        overall: report,
        byState: [],
      }
      const html = renderActivityPanel(response)
      expect(html).toContain('cmd_a')
      expect(html).toContain('cmd_b')
      // Verify ordering: cmd_a (count:2) should appear before cmd_b (count:1)
      expect(html.indexOf('cmd_a')).toBeLessThan(html.indexOf('cmd_b'))
    })
  })
})