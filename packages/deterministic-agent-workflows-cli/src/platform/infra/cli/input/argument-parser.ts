import type { ZodType } from 'zod'
import type { ArgParser } from '../../../domain/argument-parser-types'

function makeOptional<T>(parser: ArgParser<T>): ArgParser<T | undefined> {
  return {
    parse: (args: readonly string[], position: number, commandName: string) => {
      if (position >= args.length) {
        return {
          ok: true,
          value: undefined 
        }
      }
      return parser.parse(args, position, commandName)
    },
    optional: () => makeOptional(parser),
  }
}

/** @riviere-role cli-input-validator */
export const arg = {
  number: (name: string): ArgParser<number> => ({
    parse: (args: readonly string[], position: number, commandName: string) => {
      if (position >= args.length) {
        return {
          ok: false,
          message: `${commandName}: missing required argument <${name}>` 
        }
      }

      const raw = args[position]
      const parsed = Number.parseInt(raw, 10)
      if (Number.isNaN(parsed)) {
        return {
          ok: false,
          message: `${commandName}: not a valid number: '${raw}'` 
        }
      }

      return {
        ok: true,
        value: parsed 
      }
    },
    optional: function () {
      return makeOptional(this)
    },
  }),

  string: (name: string): ArgParser<string> => ({
    parse: (args: readonly string[], position: number, commandName: string) => {
      if (position >= args.length) {
        return {
          ok: false,
          message: `${commandName}: missing required argument <${name}>` 
        }
      }

      return {
        ok: true,
        value: args[position] 
      }
    },
    optional: function () {
      return makeOptional(this)
    },
  }),

  rest: (): ArgParser<readonly string[]> => ({
    parse: (args: readonly string[], position: number) => ({
      ok: true,
      value: args.slice(position) 
    }),
    optional: function () {
      return makeOptional(this)
    },
  }),

  state: <T extends string>(name: string, schema: ZodType<T>): ArgParser<T> => ({
    parse: (args: readonly string[], position: number, commandName: string) => {
      if (position >= args.length) {
        return {
          ok: false,
          message: `${commandName}: missing required argument <${name}>` 
        }
      }

      const raw = args[position]
      const result = schema.safeParse(raw)
      if (!result.success) {
        return {
          ok: false,
          message: `${commandName}: invalid state '${raw}'` 
        }
      }

      return {
        ok: true,
        value: result.data 
      }
    },
    optional: function () {
      return makeOptional(this)
    },
  }),
}
