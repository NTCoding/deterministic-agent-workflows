import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type {
  BaseWorkflowState,
  RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createPreToolUseHandler } from './pre-tool-use-handler'

type TestState = BaseWorkflowState
type TestWorkflow = RehydratableWorkflow<TestState>

const success = {
  type: 'success' as const,
  output: '',
}

function createEngine() {
  const checkBash = vi.fn((...args: unknown[]) => {
    void args
    return success
  })
  const checkWrite = vi.fn((...args: unknown[]) => {
    void args
    return success
  })
  const checkStopping = vi.fn((...args: unknown[]) => {
    void args
    return success
  })
  return {
    engine: {
      transaction: vi.fn(() => success),
      checkBash,
      checkStopping,
      checkWrite,
    },
    checkBash,
    checkStopping,
    checkWrite,
  }
}

function createHandler() {
  return createPreToolUseHandler<TestWorkflow, TestState, unknown>({
    bashForbidden: { commands: [] },
    isWriteAllowed: () => true,
  })
}

describe('createPreToolUseHandler', () => {
  it.each([
    ['Write', { file_path: 'src/file.ts' }],
    ['Edit', { file_path: 'src/file.ts' }],
    ['MultiEdit', { file_path: 'src/file.ts' }],
    ['NotebookEdit', { notebook_path: 'src/notebook.ipynb' }],
  ])('checks the Claude Code %s tool as a write', (toolName, toolInput) => {
    const {
      engine,
      checkWrite,
    } = createEngine()

    createHandler()(engine, 'session-1', toolName, toolInput)

    expect(checkWrite).toHaveBeenCalledOnce()
    expect(checkWrite).toHaveBeenCalledWith(
      'session-1',
      toolName,
      toolName === 'NotebookEdit' ? 'src/notebook.ipynb' : 'src/file.ts',
      expect.any(Function),
    )
  })

  it('checks OpenCode writes and every path in an apply_patch input', () => {
    const {
      engine,
      checkWrite,
    } = createEngine()
    const handler = createHandler()

    handler(engine, 'session-1', 'write', { filePath: 'src/file.ts' })
    handler(engine, 'session-1', 'edit', { filePath: 'src/file.ts' })
    handler(engine, 'session-1', 'apply_patch', { patchText: '*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n*** End Patch' })

    expect(checkWrite.mock.calls.map(([, toolName, filePath]) => [toolName, filePath])).toStrictEqual([
      ['write', 'src/file.ts'],
      ['edit', 'src/file.ts'],
      ['apply_patch', 'src/old.ts'],
      ['apply_patch', 'src/new.ts'],
    ])
  })

  it('checks Claude Code and OpenCode Bash tools through Bash policy', () => {
    const {
      engine,
      checkBash,
      checkWrite,
    } = createEngine()
    const handler = createHandler()

    handler(engine, 'session-1', 'Bash', { command: 'pwd' })
    handler(engine, 'session-1', 'bash', { command: 'pwd' })

    expect(checkBash).toHaveBeenCalledTimes(2)
    expect(checkWrite).not.toHaveBeenCalled()
  })

  it('allows non-write tools without calling write policy', () => {
    const {
      engine,
      checkWrite,
    } = createEngine()

    const result = createHandler()(engine, 'session-1', 'workflow', { operation: 'record-issue' })

    expect(result).toStrictEqual(success)
    expect(checkWrite).not.toHaveBeenCalled()
  })

  it('routes the configured question tool through stopping policy', () => {
    const {
      engine,
      checkStopping,
      checkWrite,
    } = createEngine()
    const handler = createPreToolUseHandler<TestWorkflow, TestState, unknown>({
      bashForbidden: { commands: [] },
      isWriteAllowed: () => true,
      questionToolName: 'AskUserQuestion',
    })

    const result = handler(engine, 'session-1', 'AskUserQuestion', {})

    expect(result).toStrictEqual(success)
    expect(checkStopping).toHaveBeenCalledWith('session-1', 'question', 'AskUserQuestion')
    expect(checkWrite).not.toHaveBeenCalled()
  })

  it('blocks an apply_patch tool when no edited paths can be determined', () => {
    const {
      engine,
      checkWrite,
    } = createEngine()

    const result = createHandler()(engine, 'session-1', 'apply_patch', { patchText: 'not a patch' })

    expect(result).toStrictEqual({
      type: 'blocked',
      output: 'Cannot determine every file edited by apply_patch.',
    })
    expect(checkWrite).not.toHaveBeenCalled()
  })
})
