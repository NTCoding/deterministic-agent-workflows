import {
  describe, it, expect 
} from 'vitest'
import {
  render, screen 
} from '@testing-library/react'
import { StateBadge } from './state-badge'

describe('StateBadge', () => {
  it('renders the abbreviation PLAN for PLANNING state', () => {
    render(<StateBadge state="PLANNING" />)
    expect(screen.getByText('PLAN')).toBeInTheDocument()
  })

  it('renders the abbreviation DEV for DEVELOPING state', () => {
    render(<StateBadge state="DEVELOPING" />)
    expect(screen.getByText('DEV')).toBeInTheDocument()
  })

  it('renders the abbreviation DONE for COMPLETE state', () => {
    render(<StateBadge state="COMPLETE" />)
    expect(screen.getByText('DONE')).toBeInTheDocument()
  })

  it('renders the abbreviation BLOCK for BLOCKED state', () => {
    render(<StateBadge state="BLOCKED" />)
    expect(screen.getByText('BLOCK')).toBeInTheDocument()
  })

  it('includes an accessible name describing the state', () => {
    render(<StateBadge state="PLANNING" />)
    expect(screen.getByLabelText('State: PLANNING')).toBeInTheDocument()
  })

  it('uses full state name as accessible label', () => {
    render(<StateBadge state="DEVELOPING" />)
    expect(screen.getByLabelText('State: DEVELOPING')).toBeInTheDocument()
  })

  it('falls back to first 4 characters for unknown states', () => {
    render(<StateBadge state="CUSTOM_STATE" />)
    expect(screen.getByText('CUST')).toBeInTheDocument()
  })
})
