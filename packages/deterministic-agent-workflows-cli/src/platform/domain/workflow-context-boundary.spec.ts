import {
  describe, expect, it 
} from 'vitest'
import type { EngineResult } from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  createWorkflowContextBoundary, type FreshContextLaunch 
} from './workflow-context-boundary'

function success(output = ''): EngineResult {
  return {
    type: 'success',
    output 
  }
}

function createEngineHarness(existingRetirement?: {
  readonly hostSessionId: string;
  readonly at: string 
}): {
    readonly retireCalls: {
      readonly sessionId: string;
      readonly reason: string 
    }[]
    readonly engine: {
      readonly retireContext: (sessionId: string, reason: string) => EngineResult
      readonly getContextRetirement: (sessionId: string) => {
        readonly hostSessionId: string;
        readonly at: string 
      } | undefined
    }
  } {
  const retireCalls: {
    sessionId: string;
    reason: string 
  }[] = []
  return {
    retireCalls,
    engine: {
      retireContext: (sessionId, reason) => {
        retireCalls.push({
          sessionId,
          reason 
        })
        return success()
      },
      getContextRetirement: () => existingRetirement,
    },
  }
}

describe('workflow context boundary', () => {
  it('retires the context and launches the fresh main agent with the consumer state instructions', async () => {
    const {
      engine, retireCalls 
    } = createEngineHarness()
    const launches: FreshContextLaunch[] = []
    const boundary = createWorkflowContextBoundary({
      engine,
      sessionId: 'host-1',
      launcher: {
        start: async (launch) => {
          launches.push(launch)
        },
      },
    })

    const result = await boundary.enterReviewing({ stateInstructions: 'You are in ADDRESSING_FEEDBACK.' })

    expect(result).toStrictEqual({ type: 'retired-and-launched' })
    expect({
      calls: retireCalls,
      launches,
    }).toStrictEqual({
      calls: [{
        sessionId: 'host-1',
        reason: 'Reviewing now owns the work.' 
      }],
      launches: [{
        workflowSessionId: 'host-1',
        stateInstructions: 'You are in ADDRESSING_FEEDBACK.',
      }],
    })
  })

  it('retires without launching when no launcher is configured', async () => {
    const {
      engine, retireCalls 
    } = createEngineHarness()
    const boundary = createWorkflowContextBoundary({
      engine,
      sessionId: 'host-1' 
    })

    const result = await boundary.enterReviewing({ stateInstructions: 'Instructions.' })

    expect(result).toStrictEqual({
      type: 'retired',
      reason: 'Reviewing now owns the work.' 
    })
    expect(retireCalls).toHaveLength(1)
  })

  it('is idempotent for an already retired context', async () => {
    const {
      engine, retireCalls 
    } = createEngineHarness({
      hostSessionId: 'host-1',
      at: '2026-01-01T00:00:00.000Z' 
    })
    const boundary = createWorkflowContextBoundary({
      engine,
      sessionId: 'host-1',
      launcher: {
        start: async () => {
          throw new TypeError('Launcher must not run for an already retired context.')
        },
      },
    })

    const result = await boundary.enterReviewing({ stateInstructions: 'Instructions.' })

    expect(result).toStrictEqual({
      type: 'retired',
      reason: 'This context is already retired.' 
    })
    expect(retireCalls).toHaveLength(0)
  })

  it('propagates a blocked retirement without launching', async () => {
    const engine = {
      retireContext: () => ({
        type: 'blocked' as const,
        output: 'Cannot retire',
      }),
      getContextRetirement: () => undefined,
    }
    const boundary = createWorkflowContextBoundary({
      engine,
      sessionId: 'host-1',
      launcher: {
        start: async () => {
          throw new TypeError('Launcher must not run for a blocked retirement.')
        },
      },
    })

    const result = await boundary.enterReviewing({ stateInstructions: 'Instructions.' })

    expect(result).toStrictEqual({
      type: 'blocked',
      output: 'Cannot retire' 
    })
  })
})
