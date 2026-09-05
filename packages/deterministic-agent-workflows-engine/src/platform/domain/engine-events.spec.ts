import {
  describe, expect, it
} from 'vitest'
import { isPlatformOwnedEventExcludedFromWorkflowState } from './engine-events'

describe('platform event ownership', () => {
  it('excludes ownership transfers from consumer workflow reconstruction', () => {
    expect(isPlatformOwnedEventExcludedFromWorkflowState('workflow-session-owner-transferred')).toBe(true)
  })

  it('keeps review results available to the consumer workflow', () => {
    expect(isPlatformOwnedEventExcludedFromWorkflowState('review-recorded')).toBe(false)
  })
})
