import { useQuery } from '@tanstack/react-query'
import { StateBadge } from '../../components/state-badge'
import type { SessionDetailResponse } from '../../api/schemas'
import {
  fetchSessionComparison,
  sessionComparisonQueryKey,
} from './comparison-api'

type SessionCompareProps = Readonly<{
  idA: string
  idB: string
}>

export function SessionCompare({
  idA, idB,
}: SessionCompareProps): React.JSX.Element {
  const {
    data, isPending, isError,
  } = useQuery({
    queryKey: sessionComparisonQueryKey(idA, idB),
    queryFn: () => fetchSessionComparison(idA, idB),
  })

  if (isPending) {
    return (
      <output aria-label="Loading comparison" className="block p-4 text-sm text-gray-500">
        Loading comparison…
      </output>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load comparison.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <CompareColumn heading="Session A" detail={data.sessionA} />
      <CompareColumn heading="Session B" detail={data.sessionB} />
    </div>
  )
}

type CompareColumnProps = Readonly<{
  heading: string
  detail: SessionDetailResponse
}>

function CompareColumn({
  heading, detail,
}: CompareColumnProps): React.JSX.Element {
  return (
    <section aria-label={heading} className="rounded border border-gray-200 p-4">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <StateBadge state={detail.currentState} />
      </header>
      <p className="font-mono text-sm">{detail.sessionId}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-500">Status</dt>
        <dd>{detail.status}</dd>
        <dt className="text-gray-500">Total events</dt>
        <dd>{detail.totalEvents}</dd>
        <dt className="text-gray-500">Transitions</dt>
        <dd>{detail.transitionCount}</dd>
      </dl>
    </section>
  )
}
