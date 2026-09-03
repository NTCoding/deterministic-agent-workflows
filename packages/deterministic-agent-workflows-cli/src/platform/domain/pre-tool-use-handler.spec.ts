import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type {
  BaseWorkflowState,
  EngineResult,
  PreconditionResult,
  RehydratableWorkflow,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { createPreToolUseHandler } from './pre-tool-use-handler'

type TestState = BaseWorkflowState
type TestWorkflow = RehydratableWorkflow<TestState>
type GateContext = {
  readonly toolName: string
  readonly filePath: string
  readonly command: string
}

const success = {
  type: 'success' as const,
  output: '',
}
const blocked = {
  type: 'blocked' as const,
  output: 'policy denied',
}

function createWorkflow(): TestWorkflow {
  return {
    getState: () => ({ currentStateMachineState: 'PLANNING' }),
    appendEvent: vi.fn(),
    getPendingEvents: () => [],
    startSession: vi.fn(),
    getTranscriptPath: () => 'transcript.jsonl',
    registerAgent: () => ({ pass: true }),
    handleTeammateIdle: () => ({ pass: true }),
  }
}

function createEngine() {
  const workflow = createWorkflow()
  const transaction = vi.fn((
    _sessionId: string,
    _operation: string,
    check: (candidate: TestWorkflow) => PreconditionResult,
  ) => {
    const result = check(workflow)
    return result.pass ? success : {
      type: 'blocked' as const,
      output: result.reason,
    }
  })
  const checkBash = vi.fn((...args: unknown[]): EngineResult => {
    void args
    return success
  })
  const checkWrite = vi.fn((...args: unknown[]): EngineResult => {
    void args
    return success
  })
  const checkStopping = vi.fn((...args: unknown[]): EngineResult => {
    void args
    return success
  })
  return {
    engine: {
      transaction,
      checkBash,
      checkStopping,
      checkWrite,
    },
    transaction,
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

describe('createPreToolUseHandler write policy', () => {
  it.each([
    ['Write', { file_path: 'src/file.ts' }, 'src/file.ts'],
    ['Edit', { path: 'src/path.ts' }, 'src/path.ts'],
    ['MultiEdit', { pattern: 'src/*.ts' }, 'src/*.ts'],
    ['NotebookEdit', { notebook_path: 'src/notebook.ipynb' }, 'src/notebook.ipynb'],
    ['write', { filePath: 'src/open-code.ts' }, 'src/open-code.ts'],
    ['edit', { filePath: 'src/open-code.ts' }, 'src/open-code.ts'],
  ])('checks %s using its supported path alias', (toolName, toolInput, filePath) => {
    const {
      engine,
      checkWrite,
    } = createEngine()

    const result = createHandler()(engine, 'session-1', toolName, toolInput)

    expect(result).toStrictEqual(success)
    expect(checkWrite.mock.calls).toStrictEqual([[
      'session-1', toolName, filePath, expect.any(Function),
    ]])
  })

  it('checks each unique trimmed path from every apply_patch directive', () => {
    const {
      engine,
      checkWrite,
    } = createEngine()
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/added.ts ',
      '*** Update File: src/updated.ts',
      '*** Move to: src/moved.ts',
      '*** Delete File: src/deleted.ts',
      '*** Update File: src/updated.ts',
      '*** Add File:   ',
      'ordinary patch content',
      '*** End Patch',
    ].join('\n')

    const result = createHandler()(engine, 'session-1', 'apply_patch', { command: patch })

    expect(result).toStrictEqual(success)
    expect(checkWrite.mock.calls.map(([, , filePath]) => filePath)).toStrictEqual([
      'src/added.ts',
      'src/updated.ts',
      'src/moved.ts',
      'src/deleted.ts',
    ])
  })

  it('returns the first blocked write without checking later patch paths', () => {
    const {
      engine,
      checkWrite,
    } = createEngine()
    checkWrite.mockReturnValueOnce(blocked)
    const patchText = '*** Update File: first.ts\n*** Update File: second.ts'

    const result = createHandler()(engine, 'session-1', 'apply_patch', { patchText })

    expect(result).toStrictEqual(blocked)
    expect(checkWrite.mock.calls).toStrictEqual([[
      'session-1', 'apply_patch', 'first.ts', expect.any(Function),
    ]])
  })

  it.each([
    ['write', {}],
    ['apply_patch', { patchText: 'not a patch' }],
  ])('blocks %s when its complete edited path set is unknowable', (toolName, toolInput) => {
    const {
      engine,
      checkWrite,
    } = createEngine()

    const result = createHandler()(engine, 'session-1', toolName, toolInput)

    expect(result).toStrictEqual({
      type: 'blocked',
      output: `Cannot determine every file edited by ${toolName}.`,
    })
    expect(checkWrite).not.toHaveBeenCalled()
  })
})

describe('createPreToolUseHandler routing and gates', () => {
  it.each([
    ['Bash', 'pwd'],
    ['bash', 'pwd'],
    ['powershell', 'Get-Location'],
  ])('returns the %s shell policy result', (toolName, command) => {
    const {
      engine,
      checkBash,
      checkWrite,
    } = createEngine()
    checkBash.mockReturnValueOnce(blocked)

    const result = createHandler()(engine, 'session-1', toolName, { command })

    expect(result).toStrictEqual(blocked)
    expect(checkBash.mock.calls).toStrictEqual([[
      'session-1', toolName, command, { commands: [] },
    ]])
    expect(checkWrite).not.toHaveBeenCalled()
  })

  it('gives the configured question policy precedence and returns its result', () => {
    const {
      engine,
      checkBash,
      checkStopping,
    } = createEngine()
    checkStopping.mockReturnValueOnce(blocked)
    const handler = createPreToolUseHandler<TestWorkflow, TestState, unknown>({
      bashForbidden: { commands: [] },
      isWriteAllowed: () => true,
      questionToolName: 'bash',
    })

    const result = handler(engine, 'session-1', 'bash', { command: 'pwd' })

    expect(result).toStrictEqual(blocked)
    expect(checkStopping.mock.calls).toStrictEqual([['session-1', 'question', 'bash']])
    expect(checkBash).not.toHaveBeenCalled()
  })

  it('allows non-write tools without invoking built-in policies', () => {
    const {
      engine,
      checkBash,
      checkStopping,
      checkWrite,
    } = createEngine()

    const result = createHandler()(engine, 'session-1', 'workflow', { operation: 'record-issue' })

    expect(result).toStrictEqual(success)
    expect(checkBash).not.toHaveBeenCalled()
    expect(checkStopping).not.toHaveBeenCalled()
    expect(checkWrite).not.toHaveBeenCalled()
  })

  it('runs every passing custom gate for every patch path before write policy', () => {
    const {
      engine,
      transaction,
      checkWrite,
    } = createEngine()
    const firstGate = vi.fn((...args: [TestWorkflow, GateContext]) => {
      void args
      return true as const
    })
    const secondGate = vi.fn((...args: [TestWorkflow, GateContext]) => {
      void args
      return true as const
    })
    const handler = createPreToolUseHandler<TestWorkflow, TestState, unknown>({
      bashForbidden: { commands: [] },
      isWriteAllowed: () => true,
      customGates: [
        {
          name: 'first',
          check: firstGate,
        },
        {
          name: 'second',
          check: secondGate,
        },
      ],
    })
    const patchText = '*** Update File: one.ts\n*** Add File: two.ts'

    const result = handler(engine, 'session-1', 'apply_patch', { patchText })

    expect(result).toStrictEqual(success)
    expect(transaction.mock.calls.map(([, operation]) => operation)).toStrictEqual([
      'hook:first', 'hook:second', 'hook:first', 'hook:second',
    ])
    expect(firstGate.mock.calls.map(([, context]) => context)).toStrictEqual([
      {
        toolName: 'apply_patch',
        filePath: 'one.ts',
        command: patchText,
      },
      {
        toolName: 'apply_patch',
        filePath: 'two.ts',
        command: patchText,
      },
    ])
    expect(checkWrite).toHaveBeenCalledTimes(2)
  })

  it('blocks on a failing custom gate before later gates and built-in policy', () => {
    const {
      engine,
      transaction,
      checkBash,
    } = createEngine()
    const laterGate = vi.fn((...args: [TestWorkflow, GateContext]) => {
      void args
      return true as const
    })
    const handler = createPreToolUseHandler<TestWorkflow, TestState, unknown>({
      bashForbidden: { commands: [] },
      isWriteAllowed: () => true,
      customGates: [
        {
          name: 'repository',
          check: (_workflow, context) => `Denied ${context.command}:${context.filePath}`,
        },
        {
          name: 'later',
          check: laterGate,
        },
      ],
    })

    const result = handler(engine, 'session-1', 'Bash', { command: 'rm -rf build' })

    expect(result).toStrictEqual({
      type: 'blocked',
      output: 'Denied rm -rf build:',
    })
    expect(transaction.mock.calls).toStrictEqual([[
      'session-1', 'hook:repository', expect.any(Function),
    ]])
    expect(laterGate).not.toHaveBeenCalled()
    expect(checkBash).not.toHaveBeenCalled()
  })
})

describe('createPreToolUseHandler malformed inputs', () => {
  it.each([
    ['command', { command: 42 }, 'Expected string or undefined in tool_input field. Got number: 42'],
    ['file path', { file_path: false }, 'Expected string or undefined in tool_input field. Got boolean: false'],
    ['later path alias', {
      filePath: null,
      path: { nested: true },
    }, 'Expected string or undefined in tool_input field. Got object: [object Object]'],
  ])('rejects a non-string %s', (_description, toolInput, message) => {
    const { engine } = createEngine()

    expect(() => createHandler()(engine, 'session-1', 'Write', toolInput)).toThrow(message)
  })
})
