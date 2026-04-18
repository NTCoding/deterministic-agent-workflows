import {
  describe, it, expect, vi
} from 'vitest'
import {
  render, screen
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionStatusFilterControl } from './session-status-filter-control'
import type { SessionStatusFilter } from './sessions-api'

describe('SessionStatusFilterControl', () => {
  it('renders all filter options as radio buttons', () => {
    render(<SessionStatusFilterControl value="all" onChange={vi.fn()} />)

    expect(screen.getByRole('radio', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /active/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /complete/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /stale/i })).toBeInTheDocument()
  })

  it('marks the current value as checked', () => {
    render(<SessionStatusFilterControl value="active" onChange={vi.fn()} />)

    expect(screen.getByRole('radio', { name: /active/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /all/i })).not.toBeChecked()
  })

  it('calls onChange with the selected filter value', async () => {
    const onChange = vi.fn<(next: SessionStatusFilter) => void>()
    const user = userEvent.setup()
    render(<SessionStatusFilterControl value="all" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: /complete/i }))

    expect(onChange).toHaveBeenCalledWith('complete')
  })

  it('groups radios under an accessible group name', () => {
    render(<SessionStatusFilterControl value="all" onChange={vi.fn()} />)

    expect(screen.getByRole('radiogroup', { name: /filter sessions by status/i })).toBeInTheDocument()
  })
})
