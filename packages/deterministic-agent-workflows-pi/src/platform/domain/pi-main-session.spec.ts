import {
  describe, expect, it
} from 'vitest'
import { resolvePiMainSessionId } from './pi-main-session'

describe('resolvePiMainSessionId', () => {
  it('uses the current session for a main Pi process', () => {
    expect(resolvePiMainSessionId(' current ', {})).toBe('current')
  })

  it('uses the runtime-provided parent for a child process', () => {
    expect(resolvePiMainSessionId('child', {PI_SUBAGENT_PARENT_SESSION: ' parent ',})).toBe('parent')
  })

  it('rejects a blank runtime-provided parent', () => {
    expect(() => resolvePiMainSessionId('child', {PI_SUBAGENT_PARENT_SESSION: ' ',})).toThrow('PI_SUBAGENT_PARENT_SESSION must contain a non-empty session UUID.')
  })

  it('rejects a blank current session', () => {
    expect(() => resolvePiMainSessionId(' ', {})).toThrow('Pi returned an empty session UUID.')
  })
})
