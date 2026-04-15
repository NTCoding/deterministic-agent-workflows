import {
  describe, it, expect 
} from 'vitest'
import { safeParseJson } from './transcript-types'

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson('{"a":1}')).toStrictEqual({ a: 1 })
  })

  it('returns null for invalid JSON', () => {
    expect(safeParseJson('{not-json')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(safeParseJson('')).toBeNull()
  })

  it('parses JSON primitive values', () => {
    expect(safeParseJson('42')).toBe(42)
    expect(safeParseJson('"hi"')).toBe('hi')
    expect(safeParseJson('null')).toBeNull()
  })
})
