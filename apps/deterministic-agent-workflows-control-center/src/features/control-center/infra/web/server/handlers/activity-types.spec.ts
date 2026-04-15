import {
  describe, it, expect 
} from 'vitest'
import {
  inc, parseTs, safeParseJson, str, topN 
} from './activity-types'

describe('str', () => {
  it('returns the value when it is a string', () => {
    expect(str('hello')).toBe('hello')
  })

  it.each([42, null, undefined, {}, true, [1]])('returns empty string for non-string %s', (value) => {
    expect(str(value)).toBe('')
  })
})

describe('inc', () => {
  it('initialises missing keys to 1', () => {
    const map = new Map<string, number>()
    inc(map, 'foo')
    expect(map.get('foo')).toBe(1)
  })

  it('increments existing keys', () => {
    const map = new Map<string, number>([['bar', 4]])
    inc(map, 'bar')
    expect(map.get('bar')).toBe(5)
  })
})

describe('topN', () => {
  it('returns the top-n entries sorted by count desc', () => {
    const map = new Map([['a', 1], ['b', 5], ['c', 2]])
    expect(topN(map, 2)).toStrictEqual([['b', 5], ['c', 2]])
  })

  it('returns all entries when n exceeds size', () => {
    const map = new Map([['x', 1]])
    expect(topN(map, 10)).toStrictEqual([['x', 1]])
  })

  it('returns empty for empty map', () => {
    expect(topN(new Map(), 5)).toStrictEqual([])
  })
})

describe('parseTs', () => {
  it('parses ISO timestamps to ms', () => {
    expect(parseTs('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('returns 0 for non-strings', () => {
    expect(parseTs(42)).toBe(0)
    expect(parseTs(null)).toBe(0)
    expect(parseTs(undefined)).toBe(0)
  })

  it('returns 0 for unparseable strings', () => {
    expect(parseTs('not-a-date')).toBe(0)
  })
})

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson('[1,2,3]')).toStrictEqual([1, 2, 3])
  })

  it('returns null for invalid JSON', () => {
    expect(safeParseJson('{broken')).toBeNull()
  })
})
