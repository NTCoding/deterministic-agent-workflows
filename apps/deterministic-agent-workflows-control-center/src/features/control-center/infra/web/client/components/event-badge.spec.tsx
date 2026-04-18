import {
  describe, it, expect
} from 'vitest'
import {
  render, screen 
} from '@testing-library/react'
import { EventBadge } from './event-badge'

describe('EventBadge', () => {
  it('renders the event type as label', () => {
    render(<EventBadge type="transitioned" />)
    expect(screen.getByText('transitioned')).toBeInTheDocument()
  })

  it('applies transition category styling when category="transition"', () => {
    render(<EventBadge type="transitioned" category="transition" />)
    const badge = screen.getByLabelText(/event: transitioned.*transition/i)
    expect(badge.className).toMatch(/indigo/)
  })

  it('applies permission category styling when category="permission"', () => {
    render(<EventBadge type="write-checked" category="permission" />)
    const badge = screen.getByLabelText(/event: write-checked.*permission/i)
    expect(badge.className).toMatch(/amber|yellow/)
  })

  it('marks denied events with a distinct visual cue', () => {
    render(<EventBadge type="write-checked" category="permission" denied />)
    const badge = screen.getByLabelText(/denied/i)
    expect(badge.className).toMatch(/red/)
  })
})
