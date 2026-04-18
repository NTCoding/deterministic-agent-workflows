import { useQuery } from '@tanstack/react-query'
import { StateBadge } from '../../components/state-badge'
import {
  fetchSessions, sessionsQueryKey, type SessionStatusFilter 
} from './sessions-api'
import type { SessionSummary } from '../../api/schemas'

type SessionListProps = Readonly<{ filter: SessionStatusFilter }>

export function SessionList({ filter }: SessionListProps): React.JSX.Element {
  const {
    data, isPending, isError 
  } = useQuery({
    queryKey: sessionsQueryKey(filter),
    queryFn: () => fetchSessions(filter),
  })

  if (isPending) {
    return (
      <output aria-label="Loading sessions" className="block p-4 text-sm text-gray-500">
        Loading sessions…
      </output>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load sessions. Please try again.
      </div>
    )
  }

  if (data.sessions.length === 0) {
    return <p className="p-4 text-sm text-gray-500">No sessions found.</p>
  }

  return (
    <ul className="divide-y divide-gray-200">
      {data.sessions.map((session) => (
        <SessionRow key={session.sessionId} session={session} />
      ))}
    </ul>
  )
}

type SessionRowProps = Readonly<{ session: SessionSummary }>

function SessionRow({ session }: SessionRowProps): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 p-3">
      <StateBadge state={session.currentState} />
      <span className="font-mono text-sm">{session.sessionId}</span>
    </li>
  )
}
