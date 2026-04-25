import {
  describe,
  expect,
  it,
} from 'vitest'
import { reviewFindingSchema } from './review-types'

describe('reviewFindingSchema', () => {
  it('rejects empty finding records', () => {
    const result = reviewFindingSchema.safeParse({})

    expect(result.success).toBe(false)
  })

  it('rejects end line before start line', () => {
    const result = reviewFindingSchema.safeParse({
      title: 'Invalid range',
      startLine: 10,
      endLine: 9,
    })

    expect(result.success).toBe(false)
  })

  it('accepts finding records with a title and single start line', () => {
    const result = reviewFindingSchema.parse({
      title: 'Missing test',
      startLine: 10,
    })

    expect(result).toStrictEqual({
      title: 'Missing test',
      startLine: 10,
    })
  })
})
