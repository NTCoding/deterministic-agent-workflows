import { PiCommandArgumentError } from './pi-command-argument-error'

type ParseState = {
  readonly tokens: readonly string[]
  readonly current: string
  readonly quote: '"' | "'" | undefined
  readonly escaping: boolean
  readonly tokenStarted: boolean
}

function nextState(state: ParseState, character: string): ParseState {
  if (state.escaping) return {
    ...state,
    current: `${state.current}${character}`,
    escaping: false,
  }
  if (character === '\\') return {
    ...state,
    escaping: true,
    tokenStarted: true,
  }
  if (state.quote !== undefined) return character === state.quote
    ? {
      ...state,
      quote: undefined,
    }
    : {
      ...state,
      current: `${state.current}${character}`,
    }
  if (character === '"' || character === "'") return {
    ...state,
    quote: character,
    tokenStarted: true,
  }
  if (/\s/.test(character)) return state.tokenStarted
    ? {
      tokens: [...state.tokens, state.current],
      current: '',
      quote: undefined,
      escaping: false,
      tokenStarted: false,
    }
    : state
  return {
    ...state,
    current: `${state.current}${character}`,
    tokenStarted: true,
  }
}

/** @riviere-role domain-service */
export function parsePiCommandArguments(input: string): readonly string[] {
  const parsed = [...input].reduce<ParseState>(nextState, {
    tokens: [],
    current: '',
    quote: undefined,
    escaping: false,
    tokenStarted: false,
  })
  if (parsed.quote !== undefined) throw new PiCommandArgumentError(`Unmatched ${parsed.quote} quote in workflow command arguments.`)
  if (parsed.escaping) throw new PiCommandArgumentError('Workflow command arguments end with an unmatched escape character.')
  return parsed.tokenStarted ? [...parsed.tokens, parsed.current] : parsed.tokens
}
