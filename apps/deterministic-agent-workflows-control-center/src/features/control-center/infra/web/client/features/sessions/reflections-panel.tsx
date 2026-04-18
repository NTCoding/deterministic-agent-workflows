import { useQuery } from '@tanstack/react-query'
import {
  fetchSessionReflections, sessionReflectionsQueryKey,
} from './sessions-api'
import type { ReflectionEntry } from '../../api/schemas'

type ReflectionsPanelProps = Readonly<{ sessionId: string }>

export function ReflectionsPanel({ sessionId }: ReflectionsPanelProps): React.JSX.Element {
  const {
    data, isPending, isError,
  } = useQuery({
    queryKey: sessionReflectionsQueryKey(sessionId),
    queryFn: () => fetchSessionReflections(sessionId),
  })

  if (isPending) {
    return (
      <output aria-label="Loading reflections" className="block p-4 text-sm text-gray-500">
        Loading reflections…
      </output>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load reflections.
      </div>
    )
  }

  if (data.reflections.length === 0) {
    return <p className="p-4 text-sm text-gray-500">No reflections recorded yet.</p>
  }

  return (
    <ul className="space-y-4">
      {data.reflections.map((entry) => (
        <ReflectionGroup key={entry.id} entry={entry} />
      ))}
    </ul>
  )
}

type ReflectionGroupProps = Readonly<{ entry: ReflectionEntry }>

function ReflectionGroup({ entry }: ReflectionGroupProps): React.JSX.Element {
  return (
    <li className="rounded border border-gray-200 p-3">
      <time className="block text-xs text-gray-500" dateTime={entry.createdAt}>
        {entry.createdAt}
      </time>
      <ul className="mt-2 space-y-1 text-sm">
        {entry.reflection.findings.map((finding, index) => (
          <li key={index} className="flex items-start gap-2">
            <span className="font-mono text-xs uppercase text-indigo-700">{finding.type}</span>
            <span>{finding.description}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}
