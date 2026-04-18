import { useQuery } from '@tanstack/react-query'
import {
  analyticsOverviewQueryKey,
  fetchAnalyticsOverview,
  type AnalyticsOverview as AnalyticsOverviewData,
} from './analytics-api'

export function AnalyticsOverview(): React.JSX.Element {
  const {
    data, isPending, isError,
  } = useQuery({
    queryKey: analyticsOverviewQueryKey(),
    queryFn: fetchAnalyticsOverview,
  })

  if (isPending) {
    return (
      <output aria-label="Loading analytics" className="block p-4 text-sm text-gray-500">
        Loading analytics…
      </output>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load analytics.
      </div>
    )
  }

  return <OverviewTiles data={data} />
}

type OverviewTilesProps = Readonly<{ data: AnalyticsOverviewData }>

function OverviewTiles({ data }: OverviewTilesProps): React.JSX.Element {
  const tiles: readonly {
    label: string;
    value: number 
  }[] = [
    {
      label: 'Total sessions',
      value: data.totalSessions
    },
    {
      label: 'Active sessions',
      value: data.activeSessions
    },
    {
      label: 'Completed sessions',
      value: data.completedSessions
    },
    {
      label: 'Stale sessions',
      value: data.staleSessions
    },
    {
      label: 'Total events',
      value: data.totalEvents
    },
    {
      label: 'Avg transitions',
      value: data.averageTransitionCount
    },
    {
      label: 'Avg denials',
      value: data.averageDenialCount
    },
  ]

  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <li key={tile.label} className="rounded border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">{tile.label}</p>
          <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
        </li>
      ))}
    </ul>
  )
}
