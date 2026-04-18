import { useQuery } from '@tanstack/react-query'
import { StateBadge } from '../../components/state-badge'
import { useSSE } from '../../hooks/use-sse'
import {
  SessionNotFoundError,
  fetchSessionDetail,
  sessionDetailQueryKey,
} from './sessions-api'
import { TranscriptView } from './transcript-view'
import { ReflectionsPanel } from './reflections-panel'

type SessionDetailProps = Readonly<{ sessionId: string }>

export function SessionDetail({ sessionId }: SessionDetailProps): React.JSX.Element {
  useSSE(sessionId)
  const {
    data, isPending, error
  } = useQuery({
    queryKey: sessionDetailQueryKey(sessionId),
    queryFn: () => fetchSessionDetail(sessionId),
    retry: false,
  })

  if (isPending) {
    return (
      <output aria-label="Loading session" className="block p-6 text-sm text-gray-500">
        Loading session…
      </output>
    )
  }

  if (error) {
    if (error instanceof SessionNotFoundError) {
      return (
        <div role="alert" className="m-6 rounded border border-amber-200 bg-amber-50 p-4 text-amber-800">
          Session {error.sessionId} not found.
        </div>
      )
    }
    return (
      <div role="alert" className="m-6 rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load session. Please try again.
      </div>
    )
  }

  return (
    <article className="p-6">
      <header className="mb-4 flex items-center gap-3">
        <StateBadge state={data.currentState} />
        <h1 className="font-mono text-2xl">{data.sessionId}</h1>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">Status</dt>
        <dd>{data.status}</dd>
        <dt className="text-gray-500">Total events</dt>
        <dd>{data.totalEvents}</dd>
        <dt className="text-gray-500">Transitions</dt>
        <dd>{data.transitionCount}</dd>
        <dt className="text-gray-500">Active agents</dt>
        <dd>{data.activeAgents.join(', ') || '—'}</dd>
      </dl>
      <section aria-labelledby="transcript-heading" className="mt-8">
        <h2 id="transcript-heading" className="mb-2 text-lg font-semibold">Transcript</h2>
        <TranscriptView sessionId={data.sessionId} />
      </section>
      <section aria-labelledby="reflections-heading" className="mt-8">
        <h2 id="reflections-heading" className="mb-2 text-lg font-semibold">Reflections</h2>
        <ReflectionsPanel sessionId={data.sessionId} />
      </section>
    </article>
  )
}
