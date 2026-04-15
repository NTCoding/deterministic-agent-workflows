import {
  describe, it, expect 
} from 'vitest'
import type { ToolCall } from './activity-types'
import { buildActivityReport } from './activity-report'

function call(name: string, input: Record<string, unknown>, ts = 1000): ToolCall {
  return {
    name,
    input,
    timestampMs: ts,
  }
}

describe('buildActivityReport', () => {
  it('returns zero-valued report for no calls', () => {
    const r = buildActivityReport([])
    expect(r.totalToolCalls).toBe(0)
    expect(r.toolCounts).toStrictEqual({})
    expect(r.bashTotal).toBe(0)
    expect(r.filesTouchedTotal).toBe(0)
  })

  it('leaves tasksDelegated empty for no calls', () => {
    expect(buildActivityReport([]).tasksDelegated).toStrictEqual([])
  })

  it('aggregates bash commands with whitespace normalisation', () => {
    const r = buildActivityReport([
      call('Bash', { command: 'git  status\n--short' }),
      call('Bash', { command: 'git status --short' }),
    ])
    expect(r.bashCommands).toStrictEqual([{
      command: 'git status --short',
      count: 2,
    }])
    expect(r.bashTotal).toBe(2)
  })

  it('ignores bash calls with no command', () => {
    const r = buildActivityReport([call('Bash', {})])
    expect(r.bashCommands).toStrictEqual([])
    expect(r.bashTotal).toBe(0)
    expect(r.toolCounts).toStrictEqual({ Bash: 1 })
  })

  it('counts Read files via each input alias', () => {
    const r = buildActivityReport([
      call('Read', { file_path: '/a.ts' }),
      call('Read', { filePath: '/b.ts' }),
      call('Read', { path: '/c.ts' }),
      call('Read', {}),
    ])
    expect(r.filesRead.map(f => f.path)).toStrictEqual(['/a.ts', '/b.ts', '/c.ts'])
  })

  it('aggregates Write/Edit/MultiEdit into the right buckets', () => {
    const r = buildActivityReport([
      call('Write', { file_path: '/w.ts' }),
      call('Edit', { file_path: '/e.ts' }),
      call('MultiEdit', { path: '/m.ts' }),
      call('apply_patch', { file_path: '/p.ts' }),
    ])
    expect(r.filesWritten.map(f => f.path)).toStrictEqual(['/w.ts'])
    expect(r.filesEdited.map(f => f.path).sort((a, b) => a.localeCompare(b))).toStrictEqual(['/e.ts', '/m.ts', '/p.ts'])
  })

  it('extracts file paths from apply_patch patch text when no explicit path', () => {
    const patch = [
      '*** Update File: src/a.ts',
      '*** Add File: src/b.ts',
      '*** Delete File: src/c.ts',
    ].join('\n')
    const r = buildActivityReport([call('apply_patch', { patchText: patch })])
    expect(r.filesEdited.map(f => f.path).sort((a, b) => a.localeCompare(b))).toStrictEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('falls back to other patch keys when patchText is empty', () => {
    const r = buildActivityReport([
      call('apply_patch', { patch: '*** Update File: src/x.ts' }),
    ])
    expect(r.filesEdited.map(f => f.path)).toStrictEqual(['src/x.ts'])
  })

  it('ignores patch input with no recognised file markers', () => {
    const r = buildActivityReport([call('apply_patch', { patchText: 'random diff' })])
    expect(r.filesEdited).toStrictEqual([])
  })

  it('counts grep and glob patterns', () => {
    const r = buildActivityReport([
      call('Grep', { pattern: 'foo' }),
      call('Grep', { pattern: 'foo' }),
      call('Glob', { pattern: '*.ts' }),
      call('Grep', {}),
    ])
    expect(r.grepSearches).toStrictEqual([{
      pattern: 'foo',
      count: 2,
    }])
    expect(r.globSearches).toStrictEqual([{
      pattern: '*.ts',
      count: 1,
    }])
  })

  it('collects task delegations with subagent + description', () => {
    const r = buildActivityReport([
      call('Task', {
        subagent_type: 'explorer',
        description: 'find tests',
      }),
      call('Agent', {
        type: 'plan',
        prompt: 'a very long prompt that should be truncated to one hundred and twenty characters total exactly please keep going for a while',
      }),
      call('Task', {}),
    ])
    expect(r.tasksDelegated).toHaveLength(3)
    expect(r.tasksDelegated[0]).toStrictEqual({
      subagent: 'explorer',
      description: 'find tests',
    })
    expect(r.tasksDelegated[1]?.subagent).toBe('plan')
    expect(r.tasksDelegated[2]?.subagent).toBe('agent')
  })

  it('counts web fetches and searches', () => {
    const r = buildActivityReport([
      call('WebFetch', { url: 'https://x/a' }),
      call('WebSearch', { query: 'x' }),
      call('WebFetch', {}),
      call('WebSearch', {}),
    ])
    expect(r.webFetches).toStrictEqual([{
      url: 'https://x/a',
      count: 1,
    }])
    expect(r.webSearches).toStrictEqual([{
      url: 'x',
      count: 1,
    }])
  })

  it('records unknown tools in toolCounts only', () => {
    const r = buildActivityReport([
      call('CustomTool', { foo: 'bar' }),
    ])
    expect(r.toolCounts).toStrictEqual({ CustomTool: 1 })
    expect(r.filesEdited).toStrictEqual([])
    expect(r.bashTotal).toBe(0)
  })

  it('counts filesTouchedTotal as union of read/edited/written', () => {
    const r = buildActivityReport([
      call('Read', { file_path: '/a.ts' }),
      call('Edit', { file_path: '/a.ts' }),
      call('Write', { file_path: '/b.ts' }),
    ])
    expect(r.filesTouchedTotal).toBe(2)
  })
})
