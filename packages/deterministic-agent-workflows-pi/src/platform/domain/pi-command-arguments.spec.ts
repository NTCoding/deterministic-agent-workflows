import {
  describe,
  expect,
  it,
} from 'vitest'
import { PiCommandArgumentError } from './pi-command-argument-error'
import { parsePiCommandArguments } from './pi-command-arguments'

describe('parsePiCommandArguments', () => {
  it.each([
    ['transition DEVELOPING', ['transition', 'DEVELOPING']],
    [String.raw`record-note "quoted value"`, ['record-note', 'quoted value']],
    [String.raw`record-note 'it\'s ready'`, ['record-note', "it's ready"]],
    [String.raw`record-note "a \"quoted\" value"`, ['record-note', 'a "quoted" value']],
    ['record-note ""', ['record-note', '']],
    ['  ', []],
  ])('parses %s', (input, expected) => {
    expect(parsePiCommandArguments(input)).toStrictEqual(expected)
  })

  it.each([
    ['record-note "unfinished', 'Unmatched " quote'],
    ["record-note 'unfinished", "Unmatched ' quote"],
    ['record-note unfinished\\', 'unmatched escape character'],
  ])('rejects malformed input %s', (input, message) => {
    expect(() => parsePiCommandArguments(input)).toThrow(PiCommandArgumentError)
    expect(() => parsePiCommandArguments(input)).toThrow(message)
  })
})
