import { useState } from 'react'
import { SessionList } from './session-list'
import { SessionStatusFilterControl } from './session-status-filter-control'
import type { SessionStatusFilter } from './sessions-api'

export function SessionDashboard(): React.JSX.Element {
  const [filter, setFilter] = useState<SessionStatusFilter>('all')

  return (
    <section className="p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <SessionStatusFilterControl value={filter} onChange={setFilter} />
      </header>
      <SessionList filter={filter} />
    </section>
  )
}
