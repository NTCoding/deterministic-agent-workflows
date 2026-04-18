import { useQuery } from '@tanstack/react-query'
import { EventBadge } from '../../components/event-badge'
import {
  fetchSessionEvents, sessionEventsQueryKey,
} from './sessions-api'
import type { AnnotatedEvent } from '../../api/schemas'

type TranscriptViewProps = Readonly<{ sessionId: string }>

export function TranscriptView({ sessionId }: TranscriptViewProps): React.JSX.Element {
  const {
    data, isPending, isError,
  } = useQuery({
    queryKey: sessionEventsQueryKey(sessionId),
    queryFn: () => fetchSessionEvents(sessionId),
  })

  if (isPending) {
    return (
      <output aria-label="Loading transcript" className="block p-4 text-sm text-gray-500">
        Loading transcript…
      </output>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load transcript.
      </div>
    )
  }

  if (data.events.length === 0) {
    return <p className="p-4 text-sm text-gray-500">No events recorded yet.</p>
  }

  return (
    <ol className="divide-y divide-gray-200">
      {data.events.map((event) => (
        <TranscriptRow key={event.seq} event={event} />
      ))}
    </ol>
  )
}

type TranscriptRowProps = Readonly<{ event: AnnotatedEvent }>

function TranscriptRow({ event }: TranscriptRowProps): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 p-2">
      <time className="w-40 shrink-0 font-mono text-xs text-gray-500" dateTime={event.recordedAt}>
        {event.recordedAt}
      </time>
      <EventBadge type={event.type} category={event.category} denied={event.denied} />
      <span className="text-sm text-gray-700">{event.detail}</span>
    </li>
  )
}
