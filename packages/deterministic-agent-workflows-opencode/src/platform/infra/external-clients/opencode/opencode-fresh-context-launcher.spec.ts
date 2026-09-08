import {
  describe, expect, it 
} from 'vitest'
import {
  createOpenCodeFreshContextLauncher, type OpenCodeFreshContextLauncherDeps 
} from './opencode-fresh-context-launcher'

function createClientHarness(createdSessionIds: readonly string[]): {
  readonly createdSessions: () => number
  readonly prompts: () => readonly {
    readonly id: string;
    readonly text: string 
  }[]
  readonly client: OpenCodeFreshContextLauncherDeps['client']
} {
  const state: {
    created: number
    prompts: {
      id: string
      text: string
    }[]
  } = {
    created: 0,
    prompts: [],
  }
  return {
    createdSessions: () => state.created,
    prompts: () => state.prompts,
    client: {
      session: {
        create: async () => {
          state.created = state.created + 1
          return { data: { id: createdSessionIds[state.created - 1] } }
        },
        promptAsync: async (input) => {
          state.prompts.push({
            id: input.path.id,
            text: input.body.parts.map((part) => part.text).join(''),
          })
          return {}
        },
      },
    },
  }
}

describe('open code fresh context launcher', () => {
  it('creates a fresh session and prompts it with the state instructions', async () => {
    const harness = createClientHarness(['fresh-session-1'])
    const launcher = createOpenCodeFreshContextLauncher({ client: harness.client })

    await launcher.start({
      workflowSessionId: 'workflow-session',
      stateInstructions: 'You are in ADDRESSING_FEEDBACK. Address the review threads.',
    })

    expect({
      created: harness.createdSessions(),
      prompts: harness.prompts(),
    }).toStrictEqual({
      created: 1,
      prompts: [{
        id: 'fresh-session-1',
        text: 'You are in ADDRESSING_FEEDBACK. Address the review threads.',
      }],
    })
  })

  it('fails closed when session creation returns no id', async () => {
    const launcher = createOpenCodeFreshContextLauncher({
      client: {
        session: {
          create: async () => ({ data: {} }),
          promptAsync: async () => ({}),
        },
      },
    })

    await expect(launcher.start({
      workflowSessionId: 'workflow-session',
      stateInstructions: 'Instructions.',
    })).rejects.toThrow('no session id')
  })
})
