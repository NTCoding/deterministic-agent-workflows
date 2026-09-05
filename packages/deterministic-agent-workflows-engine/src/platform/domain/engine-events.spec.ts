import {
  describe, expect, it
} from 'vitest'
import { isPlatformOwnedEventExcludedFromWorkflowState } from './engine-events'

describe('platform event ownership', () => {
  it('keeps review results available to the consumer workflow', () => {
    expect(isPlatformOwnedEventExcludedFromWorkflowState('review-recorded')).toBe(false)
  })
})
